# backend/speech_service/app/main.py

import os
import tempfile
import azure.cognitiveservices.speech as speechsdk
from fastapi import FastAPI, UploadFile, File, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import logging
import asyncio
import openai
from fastapi import Form

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Speech-to-Text API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Azure Speech configuration
speech_key = os.getenv("AZURE_SPEECH_KEY")
speech_region = os.getenv("AZURE_SPEECH_REGION")

if not speech_key or not speech_region:
    logger.error("Azure Speech credentials not found in environment variables")
    raise ValueError("Azure Speech credentials not configured")

speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
speech_config.speech_recognition_language = "en-US"  # Default language


@app.get("/")
async def root():
    return {"message": "Azure Speech-to-Text API is running"}


@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Transcribe an uploaded audio file using Azure Speech Services with support
    for both English and Chinese
    """
    # Check if file is audio
    if not file.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="File must be audio format")

    temp_file_path = None
    try:
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
            temp_file_path = temp_file.name
            contents = await file.read()
            temp_file.write(contents)

        # Configure auto language detection for English and Chinese
        auto_detect_source_language_config = (
            speechsdk.languageconfig.AutoDetectSourceLanguageConfig(
                languages=["en-US", "zh-CN"]  # English (US) and Chinese (Simplified)
            )
        )

        # Set up speech recognition from file
        audio_config = speechsdk.audio.AudioConfig(filename=temp_file_path)
        speech_recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config,
            audio_config=audio_config,
            auto_detect_source_language_config=auto_detect_source_language_config,
        )

        # Set up result collection
        utterances = []
        done = False

        # Setup callbacks
        def recognized_cb(evt):
            if evt.result.text:
                # Get the detected language if available
                detected_language = None
                if (
                    hasattr(evt.result, "properties")
                    and speechsdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguageResult
                    in evt.result.properties
                ):
                    detected_language = evt.result.properties[
                        speechsdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguageResult
                    ]

                # Create an utterance object with text and language info
                utterance = {
                    "text": evt.result.text,
                    "language": detected_language,
                    "offset": evt.result.offset,
                    "duration": evt.result.duration,
                }
                utterances.append(utterance)

        def session_stopped_cb(evt):
            nonlocal done
            done = True

        def canceled_cb(evt):
            nonlocal done
            done = True
            if evt.cancellation_details.reason == speechsdk.CancellationReason.Error:
                logger.error(
                    f"Recognition error: {evt.cancellation_details.error_details}"
                )

        # Connect callbacks
        speech_recognizer.recognized.connect(recognized_cb)
        speech_recognizer.session_stopped.connect(session_stopped_cb)
        speech_recognizer.canceled.connect(canceled_cb)

        # Start continuous recognition
        speech_recognizer.start_continuous_recognition()

        # Wait for recognition to complete
        while not done:
            await asyncio.sleep(0.1)

        # Stop recognition
        speech_recognizer.stop_continuous_recognition()

        # Return the list of utterances
        if utterances:
            return {"utterances": utterances}
        else:
            return {"error": "No speech could be recognized"}

    finally:
        # Clean up temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                import gc

                gc.collect()
                os.unlink(temp_file_path)
            except PermissionError:
                logger.warning(f"Could not delete temporary file: {temp_file_path}")


@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    await websocket.accept()

    try:
        # Set up continuous recognition
        stream_config = speechsdk.audio.AudioStreamFormat(
            samples_per_second=16000, bits_per_sample=16, channels=1
        )
        stream = speechsdk.audio.PushAudioInputStream(stream_format=stream_config)
        audio_config = speechsdk.audio.AudioConfig(stream=stream)

        speech_recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config, audio_config=audio_config
        )

        # Set up callbacks for recognition results
        async def recognized_cb(evt):
            await websocket.send_json({"type": "final", "text": evt.result.text})

        async def recognizing_cb(evt):
            await websocket.send_json({"type": "interim", "text": evt.result.text})

        async def canceled_cb(evt):
            await websocket.send_json(
                {"type": "error", "text": evt.cancellation_details.error_details}
            )

        # Connect callbacks
        speech_recognizer.recognized.connect(
            lambda evt: asyncio.ensure_future(recognized_cb(evt))
        )
        speech_recognizer.recognizing.connect(
            lambda evt: asyncio.ensure_future(recognizing_cb(evt))
        )
        speech_recognizer.canceled.connect(
            lambda evt: asyncio.ensure_future(canceled_cb(evt))
        )

        # Start continuous recognition
        speech_recognizer.start_continuous_recognition()

        # Main loop to receive audio data
        while True:
            try:
                # Receive audio chunks from WebSocket
                data = await websocket.receive_bytes()

                # Check for stop signal
                if len(data) == 0 or (len(data) == 1 and data[0] == 0):
                    break

                # Push audio data to the stream
                stream.write(data)

            except Exception as e:
                logger.error(f"Error processing audio: {str(e)}")
                await websocket.send_json({"type": "error", "text": str(e)})
                break

        # Stop recognition and clean up
        speech_recognizer.stop_continuous_recognition()
        stream.close()

    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        await websocket.send_json({"type": "error", "text": str(e)})

    finally:
        # Ensure the WebSocket is closed
        await websocket.close()


@app.post("/summarize")
async def summarize(text: str = Form(...)):
    openai.api_key = os.getenv("OPENAI_API_KEY")

    if not openai.api_key:
        raise HTTPException(status_code=500, detail="Missing OpenAI API key")

    prompt = f"""
你是一个会议助手，请根据以下会议内容提取结构化摘要：

{text}

请输出：
- 会议议题：
- 关键观点：
- Action Items（任务、负责人、截止时间）：
"""

    try:
        response = openai.ChatCompletion.create(
            model="gpt-4o-mini", messages=[{"role": "user", "content": prompt}]
        )
        result = response.choices[0].message["content"]
        return {"summary": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    import asyncio

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

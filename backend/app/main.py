# backend/speech_service/app/main.py

import os
import tempfile
import azure.cognitiveservices.speech as speechsdk
from fastapi import FastAPI, UploadFile, File, WebSocket, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketState, WebSocketDisconnect
from dotenv import load_dotenv
import logging
import asyncio
import io
import wave
import struct
import openai
import queue

# Load environment variables
load_dotenv()

# Configure logging - reduced to INFO level
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


def convert_audio_data(data, sample_rate=16000, channels=1, sample_width=2):
    """
    Convert audio data from WebM/MP4/OGG to WAV format that Azure Speech can process.
    This is a simplified converter that creates a basic WAV container.
    """
    try:
        # Create an in-memory WAV file
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, 'wb') as wav_file:
            wav_file.setnchannels(channels)  # Mono
            wav_file.setsampwidth(sample_width)  # 2 bytes (16 bits) per sample
            wav_file.setframerate(sample_rate)  # 16kHz
            
            # Write raw audio data
            wav_file.writeframes(data)
        
        # Get the WAV data
        wav_buffer.seek(0)
        return wav_buffer.read()
    except Exception as e:
        logger.error(f"Error converting audio: {e}")
        return data  # Return original data on error


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
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_file:
            temp_file_path = temp_file.name
            contents = await file.read()
            temp_file.write(contents)
        
        # Configure auto language detection for English and Chinese
        auto_detect_source_language_config = speechsdk.languageconfig.AutoDetectSourceLanguageConfig(
            languages=["en-US", "zh-CN"]  # English (US) and Chinese (Simplified)
        )
        
        # Set up speech recognition from file
        audio_config = speechsdk.audio.AudioConfig(filename=temp_file_path)
        speech_recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config, 
            audio_config=audio_config,
            auto_detect_source_language_config=auto_detect_source_language_config
        )
        
        # Set up result collection
        utterances = []
        done = False
        
        # Setup callbacks
        def recognized_cb(evt):
            if evt.result.text:
                # Get the detected language if available
                detected_language = None
                if hasattr(evt.result, 'properties') and \
                   speechsdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguageResult in evt.result.properties:
                    detected_language = evt.result.properties[
                        speechsdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguageResult]
                
                # Create an utterance object with text and language info
                utterance = {
                    "text": evt.result.text,
                    "language": detected_language,
                    "offset": evt.result.offset, 
                    "duration": evt.result.duration
                }
                utterances.append(utterance)
        
        def session_stopped_cb(evt):
            nonlocal done
            done = True
        
        def canceled_cb(evt):
            nonlocal done
            done = True
            if evt.cancellation_details.reason == speechsdk.CancellationReason.Error:
                logger.error(f"Recognition error: {evt.cancellation_details.error_details}")
        
        # Connect callbacks
        speech_recognizer.recognized.connect(recognized_cb)
        speech_recognizer.session_stopped.connect(session_stopped_cb)
        speech_recognizer.canceled.connect(canceled_cb)
        
        # Start continuous recognition
        speech_recognizer.start_continuous_recognition()
        
        # Wait for recognition to complete
        while not done:
            await asyncio.sleep(0.05)
        
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
    from starlette.websockets import WebSocketDisconnect, WebSocketState
    import httpx
    
    # Accept the WebSocket connection
    await websocket.accept()
    logger.info("WebSocket connection accepted")
    
    # Store references to be cleaned up in the finally block
    speech_recognizer = None
    stream = None
    is_listening = True
    
    # Create a thread-safe queue for messages
    message_queue = queue.Queue()
    
    # Create a queue for processing tasks asynchronously
    processing_queue = asyncio.Queue()
    
    # Create a function to send messages from the main loop
    async def process_messages():
        while is_listening:
            try:
                # Check if there are messages to send
                if not message_queue.empty():
                    message = message_queue.get_nowait()
                    
                    if websocket.client_state != WebSocketState.DISCONNECTED:
                        await websocket.send_json(message)
                    
                    message_queue.task_done()
                
                # Check if there are processing tasks to handle
                try:
                    task_data = processing_queue.get_nowait()
                    text, language, offset, duration = task_data
                    await process_final_text(text, language, offset, duration)
                    processing_queue.task_done()
                except asyncio.QueueEmpty:
                    pass
                
                # Give other tasks a chance to run
                await asyncio.sleep(0.05)
            except Exception as e:
                logger.error(f"Error processing message queue: {e}")
                await asyncio.sleep(0.5)
    
    # Add a helper function to correct text via the /correct-text endpoint
    async def get_corrected_text(text):
        if not text or len(text.strip()) == 0:
            return text
            
        try:
            # Use httpx for making the API call
            async with httpx.AsyncClient() as client:
                # Call our own endpoint to correct the text
                base_url = "http://localhost:8000"  # Or get from config
                response = await client.post(
                    f"{base_url}/correct-text",
                    data={"text": text},
                    timeout=5.0
                )
                
                if response.status_code == 200:
                    result = response.json()
                    return result["corrected"]
                else:
                    logger.error(f"Error from correction API: {response.text}")
                    return text
        except Exception as e:
            logger.error(f"Error calling correction API: {e}")
            return text
    
    async def process_final_text(original_text, language, offset, duration):
        try:
            # First, send the original text immediately
            message_queue.put({
                "type": "final_original",
                "text": original_text,
                "language": language,
                "offset": offset, 
                "duration": duration
            })
            
            # Then get corrected text
            corrected_text = await get_corrected_text(original_text)
            
            # If the correction is different, send it as well
            if corrected_text != original_text:
                message_queue.put({
                    "type": "final_corrected",
                    "text": corrected_text,
                    "original_text": original_text,
                    "language": language,
                    "offset": offset, 
                    "duration": duration
                })
        except Exception as e:
            logger.error(f"Error in process_final_text: {e}")
    
    try:
        # Set up the audio stream format for 16kHz mono audio
        stream_config = speechsdk.audio.AudioStreamFormat(
            samples_per_second=16000,
            bits_per_sample=16,
            channels=1
        )
        
        # Create a push audio stream
        stream = speechsdk.audio.PushAudioInputStream(stream_format=stream_config)
        audio_config = speechsdk.audio.AudioConfig(stream=stream)
        
        # Configure auto language detection for English and Chinese
        auto_detect_source_language_config = speechsdk.languageconfig.AutoDetectSourceLanguageConfig(
            languages=["en-US", "zh-CN"])
        
        # Create speech recognizer with language detection
        speech_recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config, 
            audio_config=audio_config,
            auto_detect_source_language_config=auto_detect_source_language_config
        )
        
        # Start the message processing task
        message_processor_task = asyncio.create_task(process_messages())
        
        # Define callback functions that add messages to the queue
        def recognized_cb(evt):
            if not is_listening:
                return
                
            if evt.result.text:
                # Get the detected language if available
                detected_language = "unknown"
                if hasattr(evt.result, 'properties') and \
                   speechsdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguageResult in evt.result.properties:
                    detected_language = evt.result.properties[
                        speechsdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguageResult]
                
                # Instead of directly calling async function, add to processing queue
                # This is thread-safe and will be processed by the async task
                try:
                    processing_queue.put_nowait((
                        evt.result.text, 
                        detected_language,
                        evt.result.offset, 
                        evt.result.duration
                    ))
                except Exception as e:
                    logger.error(f"Error adding to processing queue: {e}")
        
        def recognizing_cb(evt):
            if not is_listening:
                return
                
            if evt.result.text:
                # Add message to queue - for interim results, no correction
                message_queue.put({
                    "type": "interim",
                    "text": evt.result.text
                })
        
        def canceled_cb(evt):
            if not is_listening:
                return
                
            logger.warning(f"Recognition canceled: {evt.cancellation_details.reason}")
            if evt.cancellation_details.reason == speechsdk.CancellationReason.Error:
                error_details = evt.cancellation_details.error_details
                logger.error(f"Recognition error: {error_details}")
                
                # Add message to queue
                message_queue.put({
                    "type": "error",
                    "text": f"Recognition error: {error_details}"
                })
        
        # Connect callbacks
        speech_recognizer.recognized.connect(recognized_cb)
        speech_recognizer.recognizing.connect(recognizing_cb)
        speech_recognizer.canceled.connect(canceled_cb)
        
        # Start continuous recognition
        speech_recognizer.start_continuous_recognition()
        
        # Send confirmation to client
        await websocket.send_json({
            "type": "status",
            "text": "Recognition started"
        })
        
        # Main loop to receive audio data
        while is_listening:
            try:
                # Use a timeout for receiving data
                data = await asyncio.wait_for(websocket.receive_bytes(), timeout=1.0)
                
                # Check for stop signal or empty data
                if not data or (len(data) == 1 and data[0] == 0):
                    logger.info("Received stop signal")
                    break
                
                try:
                    # Push audio data to the stream
                    stream.write(data)
                except Exception as e:
                    logger.error(f"Error processing audio data: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "text": f"Error processing audio: {str(e)}"
                    })
                
            except asyncio.TimeoutError:
                # This is normal - just continue waiting
                continue
            except WebSocketDisconnect:
                logger.info("WebSocket disconnected")
                break
            except Exception as e:
                logger.error(f"Error processing audio: {str(e)}")
                try:
                    await websocket.send_json({
                        "type": "error",
                        "text": f"Error processing audio: {str(e)}"
                    })
                except:
                    pass
                break
        
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        try:
            await websocket.send_json({
                "type": "error",
                "text": f"Error: {str(e)}"
            })
        except:
            pass
    
    finally:
        # Clean up resources
        logger.info("Cleaning up resources")
        
        # Mark as not listening
        is_listening = False
        
        # Cancel the message processing task
        if 'message_processor_task' in locals() and message_processor_task:
            message_processor_task.cancel()
            try:
                await message_processor_task
            except asyncio.CancelledError:
                pass
        
        # Stop speech recognition
        if speech_recognizer:
            try:
                speech_recognizer.stop_continuous_recognition()
            except Exception as e:
                logger.error(f"Error stopping recognition: {e}")
        
        # Close the stream
        if stream:
            try:
                stream.close()
            except Exception as e:
                logger.error(f"Error closing stream: {e}")
        
        # Ensure the WebSocket is closed only once
        try:
            if websocket.client_state != WebSocketState.DISCONNECTED:
                await websocket.close(code=1000)
        except Exception as e:
            logger.error(f"Error closing WebSocket: {e}")

@app.post("/correct-text")
async def correct_text_endpoint(text: str = Form(...)):
    """
    Correct transcribed text using OpenAI API with conservative approach
    """
    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        raise HTTPException(status_code=500, detail="Missing OpenAI API key")

    from openai import OpenAI
    
    client = OpenAI(api_key=api_key)

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system", 
                    "content": """You are an AI assistant specialized in correcting speech-to-text transcription errors while preserving meaning and context.

Your task is to fix only the following types of errors:
1. Word substitutions where a similar-sounding word was incorrectly transcribed
2. Named entities (people, places, organizations, products) that were misheard
3. Specialized terminology relevant to the context of the conversation
4. Common homophones or words with similar pronunciations

Important rules:
- Make the minimum necessary changes to fix obvious errors
- Do NOT rearrange sentences or change grammatical structure
- Do NOT add missing words or remove words unless absolutely necessary
- Look for contextual clues to understand the subject matter
- Handle multiple languages accurately without translation
- If you're uncertain about a word or phrase, leave it unchanged
- Don't explain your changes - just return the corrected text"""
                },
                {
                    "role": "user", 
                    "content": f"Make minimal corrections to this transcription, preserving the original as much as possible: {text}"
                }
            ],
            max_tokens=200,
            temperature=0.3  # Very low temperature for more predictable, conservative corrections
        )
        result = response.choices[0].message.content.strip()
        return {"original": text, "corrected": result}
    except Exception as e:
        logger.error(f"Text correction error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/summarize")
async def summarize(text: str = Form(...)):
    """
    Summarize text using OpenAI API to generate meeting summaries
    """
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
        logger.error(f"Summarization error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
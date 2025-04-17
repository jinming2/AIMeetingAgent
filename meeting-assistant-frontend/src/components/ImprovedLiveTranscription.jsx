import { useState, useEffect, useRef } from 'react';

function ImprovedLiveTranscription({ onTranscriptUpdate }) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState(''); // Add state for interim results
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('idle');
  const [messageLog, setMessageLog] = useState([]); // For debugging
  
  const websocketRef = useRef(null);
  const audioContextRef = useRef(null);
  const streamRef = useRef(null);
  const processorRef = useRef(null);
  
  // Function to start recording
  const startRecording = async () => {
    try {
      setError(null);
      setStatus('connecting');
      setTranscript(''); // Clear transcript on new recording session
      setInterimText(''); // Clear interim text
      setMessageLog([]); // Clear message log
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        } 
      });
      streamRef.current = stream;
      
      // Use a specific URL format to ensure it's correct
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsBaseUrl = window.location.hostname === 'localhost' ? 'localhost:8000' : window.location.host;
      const wsUrl = `${wsProtocol}//${wsBaseUrl}/ws/transcribe`;
      
      console.log(`Connecting to WebSocket at: ${wsUrl}`);
      
      // Create a WebSocket connection
      const websocket = new WebSocket(wsUrl);
      websocketRef.current = websocket;
      
      websocket.onopen = () => {
        console.log('WebSocket connection opened');
        setStatus('connected');
        setIsRecording(true);
        
        // Create AudioContext and connect the stream
        setupAudioProcessing(stream, websocket);
      };
      
      // Handle WebSocket messages (transcription results)
      websocket.onmessage = (event) => {
        try {
          console.log("Raw WebSocket message:", event.data);
          const data = JSON.parse(event.data);
          console.log("Parsed WebSocket message:", data);
          
          // Add to message log for debugging
          setMessageLog(prev => [...prev, `${new Date().toISOString().split('T')[1].split('.')[0]} - ${data.type}: ${data.text || JSON.stringify(data)}`]);
          
          switch(data.type) {
            case 'error':
              console.error('WebSocket error:', data.text);
              setError(`Transcription error: ${data.text}`);
              break;
              
            case 'status':
              console.log('Status update:', data.text);
              break;
              
            case 'final':
              console.log('Final transcription received:', data.text);
              
              if (data.text && data.text.trim()) {
                setInterimText(''); // Clear interim text
                
                setTranscript(current => {
                  // For final results, append to the existing transcript
                  const updatedTranscript = current ? `${current}\n${data.text}` : data.text;
                  console.log('Updated transcript:', updatedTranscript);
                  
                  // Pass the updated transcript to parent component
                  if (onTranscriptUpdate) {
                    onTranscriptUpdate(updatedTranscript);
                  }
                  
                  return updatedTranscript;
                });
              }
              break;
              
            case 'interim':
              console.log('Interim transcription received:', data.text);
              
              if (data.text && data.text.trim()) {
                setInterimText(data.text);
              }
              break;
              
            default:
              console.log('Unknown message type:', data.type, data);
          }
        } catch (err) {
          console.error('Error processing WebSocket message:', err, 'Raw data:', event.data);
          setError(`Error processing transcription: ${err.message}`);
        }
      };
      
      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError(`WebSocket error: ${error.message || 'Connection failed'}`);
        setStatus('error');
        if (isRecording) {
          stopRecording();
        }
      };
      
      websocket.onclose = (event) => {
        console.log('WebSocket closed. Code:', event.code, 'Reason:', event.reason);
        setStatus('disconnected');
        if (isRecording) {
          stopRecording();
        }
      };
      
    } catch (err) {
      console.error('Startup error:', err);
      setError(`Microphone access error: ${err.message}`);
      setStatus('error');
    }
  };
  
  // Configure audio processing to send raw PCM data
  const setupAudioProcessing = (stream, websocket) => {
    try {
      // Create new AudioContext with 16kHz sample rate
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000 // Force 16kHz sample rate for Azure compatibility
      });
      audioContextRef.current = audioContext;
      
      // Create source node from microphone stream
      const source = audioContext.createMediaStreamSource(stream);
      
      // Create script processor node for raw PCM access
      const bufferSize = 2048;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;
      
      // Process audio data
      processor.onaudioprocess = (e) => {
        if (websocket.readyState === WebSocket.OPEN) {
          try {
            // Get PCM data from input channel
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Convert Float32Array to Int16Array for Azure
            const pcmData = convertFloatTo16BitPCM(inputData);
            
            // Send the data to the server
            websocket.send(pcmData.buffer);
            
            // Log for debugging
            console.log(`Sent audio chunk: ${pcmData.byteLength} bytes`);
          } catch (err) {
            console.error('Error sending audio data:', err);
          }
        }
      };
      
      // Connect nodes: source -> processor -> destination (silent)
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      console.log('Audio processing initialized');
    } catch (err) {
      console.error('Error setting up audio processing:', err);
      setError(`Error setting up audio: ${err.message}`);
    }
  };

  // Convert Float32Array from AudioBuffer to Int16Array for Azure
  const convertFloatTo16BitPCM = (float32Array) => {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // Convert float [-1.0, 1.0] to int16 [-32768, 32767]
      // Clamp the value to avoid overflow
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  };
  
  // Function to stop recording
  const stopRecording = () => {
    // Stop the processor and audio context
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(e => console.error('Error closing AudioContext:', e));
    }
    
    // Stop the microphone stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Close WebSocket connection
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      websocketRef.current.close();
    }
    
    setIsRecording(false);
    setStatus('idle');
    setInterimText(''); // Clear interim text
  };
  
  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (isRecording) {
        stopRecording();
      }
    };
  }, [isRecording]);
  
  const getStatusText = () => {
    switch (status) {
      case 'connecting': return '连接中...';
      case 'connected': return '已连接，正在录音';
      case 'disconnected': return '已断开连接';
      case 'error': return '连接错误';
      default: return '准备就绪';
    }
  };
  
  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">🎤 实时语音转写</h2>
      
      <div className="mb-4">
        {!isRecording ? (
          <button
            onClick={startRecording}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            开始录音
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            停止录音
          </button>
        )}
        
        <span className="ml-4 text-sm font-medium">
          状态: <span className={status === 'error' ? 'text-red-600' : 'text-blue-600'}>{getStatusText()}</span>
        </span>
      </div>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 rounded-md">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      
      {isRecording && (
        <div className="mb-4 p-3 bg-blue-50 rounded-md">
          <div className="flex items-center mb-2">
            <div className="animate-pulse h-3 w-3 bg-red-600 rounded-full mr-2"></div>
            <p className="text-sm text-blue-700">正在录音并转写中...</p>
          </div>
          
          {/* Display interim results */}
          {interimText && (
            <div className="mt-2 p-2 bg-blue-100 rounded">
              <p className="text-sm text-blue-800">{interimText}</p>
            </div>
          )}
          
          <div className="w-full bg-gray-200 h-4 rounded-full overflow-hidden mt-2">
            <div className="audio-meter"></div>
          </div>
        </div>
      )}
      
      <div className="mt-4">
        <h3 className="text-lg font-medium mb-2">实时转写结果:</h3>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 min-h-20 max-h-64 overflow-y-auto">
          {transcript ? (
            transcript.split('\n').map((line, i) => (
              <p key={i} className="mb-2">{line}</p>
            ))
          ) : (
            <p className="text-gray-500 italic">当转写开始时，结果将显示在这里...</p>
          )}
        </div>
      </div>
      
      {/* Debug section to see WebSocket messages */}
      <div className="mt-6 border-t pt-4">
        <details>
          <summary className="text-sm font-medium text-gray-700 cursor-pointer">调试信息</summary>
          <div className="mt-2 bg-gray-50 p-3 rounded text-xs font-mono overflow-x-auto">
            <p>WebSocket 状态: {websocketRef.current ? websocketRef.current.readyState : 'null'}</p>
            <p>录音状态: {isRecording ? '录音中' : '已停止'}</p>
            <p>消息接收日志:</p>
            <ul className="mt-1 space-y-1">
              {messageLog.map((msg, idx) => (
                <li key={idx} className="py-1 border-b border-gray-100">
                  {typeof msg === 'string' ? msg : JSON.stringify(msg)}
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}

export default ImprovedLiveTranscription;
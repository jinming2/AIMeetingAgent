import { useState, useEffect, useRef } from 'react';

function ImprovedLiveTranscription({ onTranscriptUpdate }) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('idle');
  const [messageLog, setMessageLog] = useState([]);
  
  
  // Add state for AudioWorklet support detection
  const [supportsAudioWorklet, setSupportsAudioWorklet] = useState(true);
  
  const websocketRef = useRef(null);
  const audioContextRef = useRef(null);
  const streamRef = useRef(null);
  const workletNodeRef = useRef(null);
  
  // Function to start recording
  const startRecording = async () => {
    try {
      setError(null);
      setStatus('connecting');
      setTranscript('');
      setInterimText('');
      setMessageLog([]);
      
      // Request microphone access with specific constraints for quality
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1
        } 
      });
      streamRef.current = stream;
      
      // Connect to WebSocket
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsBaseUrl = window.location.hostname === 'localhost' ? 'localhost:8000' : window.location.host;
      const wsUrl = `${wsProtocol}//${wsBaseUrl}/ws/transcribe`;
      
      console.log(`Connecting to WebSocket at: ${wsUrl}`);
      
      const websocket = new WebSocket(wsUrl);
      websocketRef.current = websocket;
      
      websocket.onopen = () => {
        console.log('WebSocket connection opened');
        setStatus('connected');
        setIsRecording(true);
        
        // Create AudioContext and connect the stream
        setupModernAudioProcessing(stream, websocket);
      };
      
      // Handle WebSocket messages (transcription results)
      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
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
              if (data.text && data.text.trim()) {
                setInterimText(''); // Clear interim text
                
                setTranscript(current => {
                  // For final results, append to the existing transcript
                  const updatedTranscript = current ? `${current}\n${data.text}` : data.text;
                  
                  // Pass the updated transcript to parent component
                  if (onTranscriptUpdate) {
                    onTranscriptUpdate(updatedTranscript);
                  }
                  
                  return updatedTranscript;
                });
              }
              break;
              
            case 'interim':
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
  
  // Modern setup using AudioWorklet
  // Modern setup using AudioWorklet
  const setupModernAudioProcessing = async (stream, websocket) => {
    try {
      // Create AudioContext with 16kHz sample rate
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });
      audioContextRef.current = audioContext;
      
      // Load AudioWorklet module
      try {
        await audioContext.audioWorklet.addModule('audio-processor.js');
        setSupportsAudioWorklet(true);
      } catch (err) {
        console.warn('AudioWorklet not supported, falling back to ScriptProcessor:', err);
        setSupportsAudioWorklet(false);
        // Fall back to legacy processing
        setupLegacyAudioProcessing(stream, websocket, audioContext);
        return;
      }
      
      // Create audio source from microphone stream
      const source = audioContext.createMediaStreamSource(stream);
      
      // Create AudioWorklet node
      const workletNode = new AudioWorkletNode(audioContext, 'transcription-processor');
      workletNodeRef.current = workletNode;
      
      // Configure the AudioWorklet
      workletNode.port.postMessage({ 
        type: 'config',
        bufferSize: 2048,
        silenceThreshold: 0.01
      });
      
      // Handle messages from AudioWorklet
      workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio') {
          // Only send data if there's speech or we've been silent too long
          if (event.data.hasSpeech || true) { // Always send data for now, can be optimized
            if (websocket.readyState === WebSocket.OPEN) {
              websocket.send(event.data.data);
            }
          }
        }
      };
      
      // Connect audio nodes: source -> worklet
      source.connect(workletNode);
      workletNode.connect(audioContext.destination);
      
      console.log('Modern audio processing initialized with AudioWorklet');
    } catch (err) {
      console.error('Error setting up modern audio processing:', err);
      setError(`Error setting up audio: ${err.message}`);
      
      // Fall back to legacy processing if modern setup fails
      setupLegacyAudioProcessing(stream, websocket);
    }
  };
  
  // Legacy fallback using ScriptProcessor (for browsers without AudioWorklet)
  const setupLegacyAudioProcessing = (stream, websocket, existingContext = null) => {
    try {
      // Use existing context or create a new one
      const audioContext = existingContext || new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });
      audioContextRef.current = audioContext;
      
      // Create source node from microphone stream
      const source = audioContext.createMediaStreamSource(stream);
      
      // Create analyzer for visualization
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 256;
      const bufferLength = analyzer.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      // Set up visualization
      const updateVisualization = () => {
        if (!isRecording) return;
        
        analyzer.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const level = average / 256; // Normalize to 0-1
        
        
        requestAnimationFrame(updateVisualization);
      };
      updateVisualization();
      
      // Create script processor node for raw PCM access
      const bufferSize = 2048;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      // Process audio data
      processor.onaudioprocess = (e) => {
        if (websocket.readyState === WebSocket.OPEN) {
          try {
            // Get PCM data from input channel
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Convert Float32Array to Int16Array
            const int16Array = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            // Send the data to the server
            websocket.send(int16Array.buffer);
          } catch (err) {
            console.error('Error sending audio data:', err);
          }
        }
      };
      
      // Connect nodes: source -> analyzer -> processor -> destination
      source.connect(analyzer);
      analyzer.connect(processor);
      processor.connect(audioContext.destination);
      
      console.log('Legacy audio processing initialized with ScriptProcessor');
    } catch (err) {
      console.error('Error setting up legacy audio processing:', err);
      setError(`Error setting up audio: ${err.message}`);
    }
  };
  
  // Function to stop recording
  const stopRecording = () => {
    // Stop any AudioWorklet node
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    
    // Close the AudioContext
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(e => console.error('Error closing AudioContext:', e));
      }
      audioContextRef.current = null;
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
    setInterimText('');
    
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
          状态: <span className={status === 'error' ? 'text-red-600' : 'text-blue-600'}>
            {getStatusText()} {!supportsAudioWorklet && isRecording ? "(使用兼容模式)" : ""}
          </span>
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
            <p>使用 AudioWorklet: {supportsAudioWorklet ? '是' : '否 (使用 ScriptProcessor 兼容模式)'}</p>
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
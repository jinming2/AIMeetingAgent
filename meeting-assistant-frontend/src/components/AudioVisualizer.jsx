import { useRef, useEffect } from 'react';

function AudioVisualizer({ stream, isRecording }) {
  const canvasRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  
  // Set up audio analyzer when recording starts
  useEffect(() => {
    let audioContext = null;
    let analyser = null;
    let microphone = null;
    
    if (stream && isRecording) {
      try {
        // Create audio context
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyserRef.current = analyser;
        
        // Connect microphone to analyzer
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        
        // Configure analyzer
        analyser.fftSize = 256;
        
        // Start visualization
        visualize();
        
        // Log audio levels for debugging
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const logVolume = setInterval(() => {
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
          console.log(`Microphone volume: ${average.toFixed(2)}`);
        }, 1000);
        
        return () => {
          // Clean up
          if (microphone) microphone.disconnect();
          if (audioContext) audioContext.close();
          if (animationRef.current) cancelAnimationFrame(animationRef.current);
          clearInterval(logVolume);
        };
      } catch (err) {
        console.error("Error setting up audio visualization:", err);
      }
    }
  }, [stream, isRecording]);
  
  // Visualization function
  const visualize = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Clear canvas
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      
      // Get audio data
      analyser.getByteFrequencyData(dataArray);
      
      // Clear canvas
      canvasCtx.fillStyle = 'rgb(240, 240, 240)';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Calculate bar width
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;
      
      // Draw bars
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = dataArray[i] / 2;
        
        canvasCtx.fillStyle = `rgb(60, 100, ${barHeight + 100})`;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        
        x += barWidth + 1;
      }
    };
    
    draw();
  };
  
  return (
    <div className="mt-4">
      <p className="text-sm font-medium mb-1">Microphone Activity:</p>
      <canvas 
        ref={canvasRef} 
        className="w-full h-16 bg-gray-100 rounded-md" 
        width="300" 
        height="70"
      />
    </div>
  );
}

export default AudioVisualizer;
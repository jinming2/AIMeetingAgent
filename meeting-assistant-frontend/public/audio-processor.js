// audio-processor.js - AudioWorklet processor for real-time transcription
// This file needs to be served as a separate file from your web server

class TranscriptionProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      
      // Configure buffer for audio processing
      this._buffer = [];
      this._bufferSize = 2048; // Can be adjusted based on performance needs
      
      // For voice activity detection
      this._silenceThreshold = 0.01;
      this._isSpeaking = false;
      this._silenceCounter = 0;
      this._silenceFramesThreshold = 20; // About 400ms of silence at typical frame sizes
      
      // Setup communication with main thread
      this.port.onmessage = (event) => {
        if (event.data.type === 'config') {
          // Allow runtime configuration from main thread
          if (event.data.bufferSize) this._bufferSize = event.data.bufferSize;
          if (event.data.silenceThreshold) this._silenceThreshold = event.data.silenceThreshold;
        }
      };
    }
  
    // Simple voice activity detection to avoid sending silence
    _detectSpeech(input) {
      // Calculate average energy in the frame
      let energy = 0;
      for (let i = 0; i < input.length; i++) {
        energy += Math.abs(input[i]);
      }
      energy /= input.length;
      
      // Check if energy is above threshold
      const isSpeaking = energy > this._silenceThreshold;
      
      // Add hysteresis to avoid rapid switching
      if (isSpeaking) {
        this._silenceCounter = 0;
        this._isSpeaking = true;
      } else {
        this._silenceCounter++;
        if (this._silenceCounter > this._silenceFramesThreshold) {
          this._isSpeaking = false;
        }
      }
      
      return this._isSpeaking;
    }
  
    // Convert from AudioWorklet's Float32Array [-1.0,1.0] to Int16Array [-32768,32767]
    _convertFloatTo16BitPCM(float32Array) {
      const int16Array = new Int16Array(float32Array.length);
      for (let i = 0; i < float32Array.length; i++) {
        // Clamp the value to avoid overflow
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return int16Array;
    }
  
    process(inputs, outputs, parameters) {
      // Get audio from the first input channel
      const input = inputs[0][0];
      
      if (input && input.length > 0) {
        // Check if there's actual speech (not silence)
        const hasSpeech = this._detectSpeech(input);
        
        // Always add data to buffer for context
        this._buffer.push(...input);
        
        // When buffer is full, process it
        if (this._buffer.length >= this._bufferSize) {
          // Convert buffer to Int16Array suitable for speech recognition
          const pcmData = this._convertFloatTo16BitPCM(this._buffer.slice(0, this._bufferSize));
          
          // Send to main thread with speech detection info
          this.port.postMessage({
            type: 'audio',
            data: pcmData,
            hasSpeech: hasSpeech
          }, [pcmData.buffer]); // Transfer the buffer for better performance
          
          // Clear processed data from buffer
          this._buffer = this._buffer.slice(this._bufferSize);
        }
      }
      
      // Return true to keep the processor alive
      return true;
    }
  }
  
  // Register the processor
  registerProcessor('transcription-processor', TranscriptionProcessor);
// Local copy of SDK functions for demo
// This avoids import path issues with React's build system

// Helper functions for base64 encoding/decoding 
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const uint8Array = new Uint8Array(buffer);
  const chars = Array.from(uint8Array, byte => String.fromCharCode(byte));
  return btoa(chars.join(''));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// VAD Configuration interface
export interface VADConfig {
  sensitivity?: number; // 0-3, where 0 is least sensitive, 3 is most sensitive
  frameDuration?: number; // 10, 20, or 30 ms
  sampleRate?: number; // 8000, 16000, 32000, or 48000 Hz
}

// Default VAD configuration
const DEFAULT_VAD_CONFIG: Required<VADConfig> = {
  sensitivity: 2,
  frameDuration: 30,
  sampleRate: 16000
};

/**
 * Records audio from microphone and yields only frames containing voice activity.
 * Uses WebRTC VAD to detect speech in real-time.
 * 
 * @param config Optional VAD configuration
 * @returns AsyncIterable yielding frames with voice activity
 */
export async function* recordAndDetectVoice(config: VADConfig = {}): AsyncIterable<{ frame: ArrayBuffer; timestamp: number }> {
  console.log('=== VAD: Function called ===');
  
  const vadConfig = { ...DEFAULT_VAD_CONFIG, ...config };
  
  // Validate configuration
  if (vadConfig.sensitivity < 0 || vadConfig.sensitivity > 3) {
    throw new Error('VAD sensitivity must be between 0 and 3');
  }
  if (![10, 20, 30].includes(vadConfig.frameDuration)) {
    throw new Error('VAD frame duration must be 10, 20, or 30 ms');
  }
  if (![8000, 16000, 32000, 48000].includes(vadConfig.sampleRate)) {
    throw new Error('VAD sample rate must be 8000, 16000, 32000, or 48000 Hz');
  }

  console.log('VAD: Starting voice detection with config:', vadConfig);

  // Request microphone access
  console.log('VAD: Requesting microphone access...');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        sampleRate: vadConfig.sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      } 
    });
    console.log('VAD: Got microphone stream successfully');
  } catch (error) {
    console.error('VAD: Failed to get microphone stream:', error);
    throw error;
  }

  // Create audio context
  console.log('VAD: Creating audio context...');
  const audioContext = new AudioContext({ sampleRate: vadConfig.sampleRate });
  console.log('VAD: Audio context created, state:', audioContext.state);
  
  const source = audioContext.createMediaStreamSource(stream);
  console.log('VAD: Media stream source created');
  
  // Calculate frame size in samples
  const frameSize = (vadConfig.sampleRate * vadConfig.frameDuration) / 1000;
  console.log('VAD: Frame size in samples:', frameSize);
  
  // Create buffer for processing
  const buffer = new Float32Array(frameSize);
  let bufferIndex = 0;
  
  // Create script processor for real-time processing
  // Use a power-of-two buffer size that's compatible with ScriptProcessorNode
  const processorBufferSize = Math.pow(2, Math.ceil(Math.log2(frameSize)));
  console.log('VAD: Creating script processor with buffer size:', processorBufferSize);
  const processor = audioContext.createScriptProcessor(processorBufferSize, 1, 1);
  console.log('VAD: Script processor created');
  
  let frameCount = 0;
  const startTime = Date.now();
  
  // Set up frame queue and control
  const frameQueue: { frame: ArrayBuffer; timestamp: number }[] = [];
  let isDone = false;
  let audioProcessed = false;
  let resolveNext: ((value: { frame: ArrayBuffer; timestamp: number }) => void) | null = null;
  
  // Set up audio processing
  console.log('VAD: Setting up audio processing...');
  processor.onaudioprocess = (event) => {
    if (isDone) return;
    
    if (!audioProcessed) {
      console.log('VAD: First audio process event received!');
      audioProcessed = true;
    }
    
    const input = event.inputBuffer.getChannelData(0);
    
    // Process all input samples
    for (let i = 0; i < input.length; i++) {
      buffer[bufferIndex] = input[i];
      bufferIndex++;
      
      if (bufferIndex >= frameSize) {
        // Process complete frame
        const hasVoice = detectVoiceActivity(buffer, vadConfig.sensitivity);
        
        if (hasVoice) {
          // Convert to 16-bit PCM for compatibility
          const pcmFrame = convertToPCM(buffer);
          const timestamp = startTime + (frameCount * vadConfig.frameDuration);
          
          console.log(`VAD: Voice detected! Frame ${frameCount}, timestamp ${timestamp}`);
          
          const frameData = {
            frame: pcmFrame,
            timestamp
          };
          
          // Add to queue or resolve immediately
          if (resolveNext) {
            console.log('VAD: Resolving immediately with frame');
            resolveNext(frameData);
            resolveNext = null;
          } else {
            console.log('VAD: Adding frame to queue');
            frameQueue.push(frameData);
          }
        } else {
          // Log some non-voice frames too for debugging
          if (Math.random() < 0.1) { // Log 10% of non-voice frames
            console.log(`VAD: No voice in frame ${frameCount}`);
          }
        }
        
        bufferIndex = 0;
        frameCount++;
      }
    }
  };
  
  // Connect audio nodes
  console.log('VAD: Connecting audio nodes...');
  source.connect(processor);
  processor.connect(audioContext.destination);
  console.log('VAD: Audio nodes connected');
  
  // Resume audio context if it's suspended
  console.log('VAD: Checking audio context state...');
  if (audioContext.state === 'suspended') {
    console.log('VAD: Resuming suspended audio context...');
    await audioContext.resume();
  }
  
  console.log('VAD: Audio context state:', audioContext.state);
  
  // Create a proper async generator
  console.log('VAD: Starting async generator loop...');
  try {
    while (!isDone) {
      console.log('VAD Generator: Waiting for next frame...');
      
      // Wait for the next frame
      const frame = await new Promise<{ frame: ArrayBuffer; timestamp: number }>((resolve) => {
        // If we have frames in queue, return immediately
        if (frameQueue.length > 0) {
          console.log('VAD Generator: returning frame from queue');
          const frame = frameQueue.shift()!;
          resolve(frame);
          return;
        }
        
        // Otherwise, wait for the next frame
        console.log('VAD Generator: waiting for next frame');
        resolveNext = resolve;
      });
      
      console.log('VAD Generator: Yielding frame');
      yield frame;
    }
  } finally {
    // Cleanup
    console.log('VAD: Cleaning up');
    isDone = true;
    stream.getTracks().forEach(track => track.stop());
    source.disconnect();
    processor.disconnect();
    audioContext.close();
  }
}

/**
 * Simple energy-based voice activity detection.
 * In a production environment, use webrtcvad for better accuracy.
 */
function detectVoiceActivity(buffer: Float32Array, sensitivity: number): boolean {
  // Calculate RMS (Root Mean Square) energy
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sum / buffer.length);
  
  // Threshold based on sensitivity (0-3)
  // Lower threshold = more sensitive
  const thresholds = [0.001, 0.0005, 0.0002, 0.0001]; // Much more sensitive thresholds for testing
  const threshold = thresholds[sensitivity] || 0.0002;
  
  // Add some debugging
  if (Math.random() < 0.01) { // Log 1% of frames to avoid spam
    console.log(`VAD: RMS=${rms.toFixed(6)}, threshold=${threshold.toFixed(6)}, sensitivity=${sensitivity}`);
  }
  
  return rms > threshold;
}

/**
 * Convert Float32Array to 16-bit PCM ArrayBuffer
 */
function convertToPCM(float32Array: Float32Array): ArrayBuffer {
  const pcmArray = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    // Convert float32 (-1 to 1) to int16 (-32768 to 32767)
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    pcmArray[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }
  return pcmArray.buffer;
}

// Export other SDK functions as needed
export { arrayBufferToBase64, base64ToArrayBuffer }; 
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

import { AudioNodeVAD } from '@ricky0123/vad-web';

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
  let resolveNext: any = null;
  
  // Initialize Silero VAD with callback
  let lastIsSpeech = false;
  const thresholds = [0.5, 0.7, 0.85, 0.95];
  const vad = await AudioNodeVAD.new(audioContext, {
    onFrameProcessed: (probs) => {
      lastIsSpeech = probs.isSpeech >= thresholds[vadConfig.sensitivity];
    },
  });

  // Set up audio processing
  console.log('VAD: Setting up audio processing...');
  processor.onaudioprocess = async (event) => {
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
        // Process frame with vad-web
        await vad.processFrame(buffer);
        if (lastIsSpeech) {
          const pcmFrame = convertToPCM(buffer);
          const timestamp = startTime + (frameCount * vadConfig.frameDuration);
          console.log(`VAD: Voice detected (burst)! Frame ${frameCount}, timestamp ${timestamp}`);
          const frameData = {
            frame: pcmFrame,
            timestamp
          };
          if (resolveNext) {
            console.log('VAD: Resolving immediately with frame');
            resolveNext(frameData);
            resolveNext = null;
          } else {
            console.log('VAD: Adding frame to queue');
            frameQueue.push(frameData);
          }
        } else {
          if (Math.random() < 0.1) {
            console.log(`VAD: No voice in frame ${frameCount} (threshold: ${thresholds[vadConfig.sensitivity]})`);
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
      const frame = await new Promise<{ frame: ArrayBuffer; timestamp: number } | undefined>((resolve) => {
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
      if (frame === undefined) break;
      
      console.log('VAD Generator: Yielding frame');
      yield frame;
    }
  } finally {
    // Cleanup
    console.log('VAD: Cleaning up');
    isDone = true;
    if (resolveNext !== null) {
      (resolveNext as Function)(undefined);
      resolveNext = null;
    }
    stream.getTracks().forEach(track => track.stop());
    source.disconnect();
    processor.disconnect();
    audioContext.close();
  }
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

export async function encryptBlob(plaintext: string, key: CryptoKey): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  // Combine IV and ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return combined;
}

export async function decryptBlob(data: Uint8Array, key: CryptoKey): Promise<string> {
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

// Export other SDK functions as needed
export { arrayBufferToBase64, base64ToArrayBuffer }; 
// Solace Client SDK - VAD only for client

// VAD Configuration interface
export interface VADConfig {
  sensitivity?: number; // 0-3, where 0 is least sensitive, 3 is most sensitive
  frameDuration?: number; // 10, 20, or 30 ms
  sampleRate?: number; // 8000, 16000, 32000, or 48000 Hz
  deviceId?: string; // Specific audio device ID to use
}

const DEFAULT_VAD_CONFIG: Required<Omit<VADConfig, 'deviceId'>> = {
  sensitivity: 2,
  frameDuration: 30,
  sampleRate: 16000
};

import { AudioNodeVAD } from '@ricky0123/vad-web';

export async function* recordAndDetectVoice(config: VADConfig = {}): AsyncIterable<{ frame: ArrayBuffer; timestamp: number }> {
  console.log('=== VAD: Function called ===');
  const vadConfig = { ...DEFAULT_VAD_CONFIG, ...config };
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
  console.log('VAD: Requesting microphone access...');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        deviceId: vadConfig.deviceId ? { exact: vadConfig.deviceId } : undefined,
        sampleRate: vadConfig.sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      } 
    });
    console.log('VAD: Got microphone stream successfully');
  } catch (error) {
    console.error('VAD: Failed to get microphone stream:', error);
    throw error;
  }
  console.log('VAD: Creating audio context...');
  const audioContext = new AudioContext({ sampleRate: vadConfig.sampleRate });
  console.log('VAD: Audio context created, state:', audioContext.state);
  const source = audioContext.createMediaStreamSource(stream);
  console.log('VAD: Media stream source created');
  const frameSize = (vadConfig.sampleRate * vadConfig.frameDuration) / 1000;
  console.log('VAD: Frame size in samples:', frameSize);
  const buffer = new Float32Array(frameSize);
  let bufferIndex = 0;
  const processorBufferSize = Math.pow(2, Math.ceil(Math.log2(frameSize)));
  const processor = audioContext.createScriptProcessor(processorBufferSize, 1, 1);
  console.log('VAD: Script processor created');
  let frameCount = 0;
  const startTime = Date.now();
  const frameQueue: { frame: ArrayBuffer; timestamp: number }[] = [];
  let isDone = false;
  let audioProcessed = false;
  let resolveNext: ((value: { frame: ArrayBuffer; timestamp: number }) => void) | null = null;
  // Initialize Silero VAD with callback
  let lastIsSpeech = false;
  const thresholds = [0.5, 0.7, 0.85, 0.95];
  const threshold = thresholds[vadConfig.sensitivity] || 0.7; // Default to 0.7 if sensitivity is out of bounds
  const vad = await AudioNodeVAD.new(audioContext, {
    onFrameProcessed: (probs) => {
      lastIsSpeech = probs.isSpeech >= threshold;
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
            console.log(`VAD: No voice in frame ${frameCount} (threshold: ${threshold})`);
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
      const frame = await new Promise<{ frame: ArrayBuffer; timestamp: number }>((resolve) => {
        if (frameQueue.length > 0) {
          console.log('VAD Generator: returning frame from queue');
          const frame = frameQueue.shift()!;
          resolve(frame);
          return;
        }
        console.log('VAD Generator: waiting for next frame');
        resolveNext = resolve;
      });
      console.log('VAD Generator: Yielding frame');
      yield frame;
    }
  } finally {
    console.log('VAD: Cleaning up');
    isDone = true;
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
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
  deviceId?: string; // Optional: specific microphone deviceId
}

// Default VAD configuration
const DEFAULT_VAD_CONFIG: Required<VADConfig> = {
  sensitivity: 2, // Match Task C for best results
  frameDuration: 30,
  sampleRate: 16000,
  deviceId: ''
};

import { MicVAD } from '@ricky0123/vad-web';

/**
 * Records audio from microphone and yields only frames containing voice activity.
 * Uses WebRTC VAD to detect speech in real-time.
 * 
 * @param config Optional VAD configuration
 * @returns AsyncIterable yielding frames with voice activity
 */
export async function* recordAndDetectVoice(config: VADConfig = {}): AsyncIterable<{ frame: ArrayBuffer; timestamp: number }> {
  console.log('=== VAD: Function called ===');
  console.log('USING RICKY SILERO VAD (MicVAD, @ricky0123/vad-web)');
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
  const frameQueue: { frame: ArrayBuffer; timestamp: number }[] = [];
  let isDone = false;
  let resolveNext: any = null;
  let frameCount = 0;
  const startTime = Date.now();
  const vad = await MicVAD.new({
    stream: undefined,
    onSpeechStart: () => console.log('[VAD DEBUG] onSpeechStart'),
    onSpeechEnd: (audio: Float32Array) => {
      console.log('[VAD DEBUG] onSpeechEnd, audio length:', audio.length);
      const rms = Math.sqrt(audio.reduce((sum, v) => sum + v * v, 0) / audio.length);
      const min = Math.min.apply(null, audio as unknown as number[]);
      const max = Math.max.apply(null, audio as unknown as number[]);
      console.log(`[VAD DEBUG] [MicVAD] Speech Segment RMS: ${rms} min: ${min} max: ${max}`);
      const pcmFrame = convertToPCM(audio);
      const timestamp = startTime + (frameCount * vadConfig.frameDuration);
      frameQueue.push({ frame: pcmFrame, timestamp });
      frameCount++;
      if (resolveNext) {
        resolveNext(frameQueue.shift());
        resolveNext = null;
      }
    }
  });
  await vad.start();
  console.log('MicVAD started');
  try {
    while (!isDone) {
      const frame = await new Promise<{ frame: ArrayBuffer; timestamp: number } | undefined>((resolve) => {
        if (frameQueue.length > 0) {
          resolve(frameQueue.shift());
          return;
        }
        resolveNext = resolve;
      });
      if (frame === undefined) break;
      yield frame;
    }
  } finally {
    isDone = true;
    if (resolveNext !== null) {
      (resolveNext as Function)(undefined);
      resolveNext = null;
    }
    await vad.pause();
    await vad.destroy();
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

// Export other SDK functions as needed
export { arrayBufferToBase64, base64ToArrayBuffer }; 
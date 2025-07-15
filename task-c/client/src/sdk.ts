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
    // Debug: List available audio devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');
    console.log('Available audio input devices:', audioInputs.map(d => ({ id: d.deviceId, label: d.label })));
    
    // Check if we have permission for audio input
    const permissions = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    console.log('Microphone permission state:', permissions.state);
    
    stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        deviceId: vadConfig.deviceId ? { exact: vadConfig.deviceId } : undefined,
        sampleRate: vadConfig.sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false // Disable auto gain to see raw audio
      } 
    });
    console.log('VAD: Got microphone stream successfully');
    console.log('VAD: Stream tracks:', stream.getTracks().map(t => ({ kind: t.kind, label: t.label, enabled: t.enabled })));
    
    // Debug: Check if this is actually a microphone stream
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      console.log('VAD: Audio track settings:', audioTrack.getSettings());
      console.log('VAD: Audio track constraints:', audioTrack.getConstraints());
      console.log('VAD: Audio track capabilities:', audioTrack.getCapabilities());
    }
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
  console.log('VAD: Creating script processor...');
  // Use next power of two for buffer size
  const processorBufferSize = Math.pow(2, Math.ceil(Math.log2(frameSize)));
  const processor = audioContext.createScriptProcessor(processorBufferSize, 1, 1);
  console.log('VAD: Script processor created');
  let frameCount = 0;
  const startTime = Date.now();
  const frameQueue: { frame: ArrayBuffer; timestamp: number }[] = [];
  let isDone = false;
  let audioProcessed = false;
  let resolveNext: ((value: { frame: ArrayBuffer; timestamp: number }) => void) | null = null;
  console.log('VAD: Setting up audio processing...');
  processor.onaudioprocess = (event) => {
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
        const hasVoice = detectVoiceActivity(buffer, vadConfig.sensitivity);
        if (hasVoice) {
          const pcmFrame = convertToPCM(buffer);
          const timestamp = startTime + (frameCount * vadConfig.frameDuration);
          console.log(`VAD: Voice detected! Frame ${frameCount}, timestamp ${timestamp}`);
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
            console.log(`VAD: No voice in frame ${frameCount}`);
          }
        }
        bufferIndex = 0;
        frameCount++;
      }
    }
  };
  console.log('VAD: Connecting audio nodes...');
  source.connect(processor);
  processor.connect(audioContext.destination);
  console.log('VAD: Audio nodes connected');
  console.log('VAD: Checking audio context state...');
  if (audioContext.state === 'suspended') {
    console.log('VAD: Resuming suspended audio context...');
    await audioContext.resume();
  }
  console.log('VAD: Audio context state:', audioContext.state);
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
  
  // Calculate additional metrics for debugging
  let maxAmplitude = 0;
  let minAmplitude = 0;
  let zeroCrossings = 0;
  for (let i = 0; i < buffer.length; i++) {
    maxAmplitude = Math.max(maxAmplitude, Math.abs(buffer[i]));
    minAmplitude = Math.min(minAmplitude, buffer[i]);
    if (i > 0 && (buffer[i] >= 0) !== (buffer[i-1] >= 0)) {
      zeroCrossings++;
    }
  }
  
  // Threshold based on sensitivity (0-3)
  // Lower threshold = more sensitive
  // Based on microphone test results, adjust thresholds to be more realistic
  const thresholds = [0.005, 0.003, 0.002, 0.001]; // Much higher thresholds based on actual speech levels
  const threshold = thresholds[sensitivity] || 0.002;
  
  // Log detailed audio analysis for debugging
  if (Math.random() < 0.05) { // Log 5% of frames to avoid spam
    console.log(`VAD: Frame analysis - RMS=${rms.toFixed(6)}, max=${maxAmplitude.toFixed(6)}, min=${minAmplitude.toFixed(6)}, zeroCrossings=${zeroCrossings}, threshold=${threshold.toFixed(6)}, sensitivity=${sensitivity}`);
    
    // Log first few samples to see what the audio looks like
    const sampleValues = Array.from(buffer.slice(0, 10)).map(v => v.toFixed(4));
    console.log(`VAD: First 10 samples: [${sampleValues.join(', ')}]`);
  }
  
  const hasVoice = rms > threshold;
  
  // Log when we actually detect voice vs background noise
  if (hasVoice && rms > threshold * 2) { // Only log when we have strong voice detection
    console.log(`VAD: STRONG VOICE DETECTED - RMS=${rms.toFixed(6)}, threshold=${threshold.toFixed(6)}`);
  } else if (hasVoice) {
    console.log(`VAD: Weak voice detected - RMS=${rms.toFixed(6)}, threshold=${threshold.toFixed(6)}`);
  }
  
  return hasVoice;
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
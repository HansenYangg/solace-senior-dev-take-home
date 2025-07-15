import React, { useState, useRef, useEffect } from 'react';
// @ts-ignore
import { recordAndDetectVoice } from './sdk';

function pcmToWav(frames: ArrayBuffer[], sampleRate = 16000): Blob {
  const pcmLength = frames.reduce((sum, buf) => sum + buf.byteLength, 0);
  const wavBuffer = new ArrayBuffer(44 + pcmLength);
  const view = new DataView(wavBuffer);
  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true); // Sample rate
  view.setUint32(28, sampleRate * 2, true); // Byte rate (sampleRate * channels * bitsPerSample/8)
  view.setUint16(32, 2, true); // Block align (channels * bitsPerSample/8)
  view.setUint16(34, 16, true); // Bits per sample
  writeString(36, 'data');
  view.setUint32(40, pcmLength, true);
  let offset = 44;
  for (const buf of frames) {
    new Uint8Array(wavBuffer, offset, buf.byteLength).set(new Uint8Array(buf));
    offset += buf.byteLength;
  }
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

const ASR_API_URL = process.env.REACT_APP_ASR_API_URL || 'https://api.openai.com/v1/audio/transcriptions';
const CHAT_API_URL = process.env.REACT_APP_CHAT_API_URL || 'https://api.openai.com/v1/chat/completions';

const App: React.FC = () => {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [chatResponse, setChatResponse] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [speechDetected, setSpeechDetected] = useState(false);
  const framesRef = useRef<ArrayBuffer[]>([]);
  const vadIteratorRef = useRef<AsyncIterableIterator<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Load available audio devices
  useEffect(() => {
    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        setAudioDevices(audioInputs);
        if (audioInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(audioInputs[0].deviceId);
        }
      } catch (err) {
        console.error('Failed to enumerate devices:', err);
      }
    };
    
    loadDevices();
    
    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
    };
  }, [selectedDeviceId]);

  // Audio level visualization
  useEffect(() => {
    if (recording && audioContextRef.current && analyserRef.current) {
      const updateAudioLevel = () => {
        const dataArray = new Uint8Array(analyserRef.current!.frequencyBinCount);
        analyserRef.current!.getByteFrequencyData(dataArray);
        
        // Calculate average level
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        setAudioLevel(average);
        
        animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
      };
      
      updateAudioLevel();
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      setAudioLevel(0);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [recording]);

  // Test microphone
  const handleTestMicrophone = async () => {
    setStatus('Testing microphone...');
    setError(null);
    try {
      // List all audio devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      console.log('=== MICROPHONE TEST ===');
      console.log('Available audio input devices:', audioInputs.map(d => ({ id: d.deviceId, label: d.label })));
      console.log('Selected device ID:', selectedDeviceId);
      
      // Get microphone stream with selected device
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        } 
      });
      
      const audioTrack = stream.getAudioTracks()[0];
      console.log('Selected audio track:', {
        label: audioTrack.label,
        settings: audioTrack.getSettings(),
        constraints: audioTrack.getConstraints(),
        capabilities: audioTrack.getCapabilities()
      });
      
      // Create audio context and analyze
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      
      // Record for 3 seconds and analyze
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const timeDataArray = new Float32Array(analyser.fftSize);
      
      let maxLevel = 0;
      let sampleCount = 0;
      const testDuration = 3000; // 3 seconds
      const startTime = Date.now();
      
      const analyzeAudio = () => {
        analyser.getByteFrequencyData(dataArray);
        analyser.getFloatTimeDomainData(timeDataArray);
        
        const currentLevel = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        maxLevel = Math.max(maxLevel, currentLevel);
        sampleCount++;
        
        // Calculate RMS of time domain data
        let rms = 0;
        for (let i = 0; i < timeDataArray.length; i++) {
          rms += timeDataArray[i] * timeDataArray[i];
        }
        rms = Math.sqrt(rms / timeDataArray.length);
        
        if (sampleCount % 10 === 0) { // Log every 10th sample
          console.log(`Test: Level=${currentLevel}, RMS=${rms.toFixed(6)}, Max=${maxLevel}`);
        }
        
        if (Date.now() - startTime < testDuration) {
          requestAnimationFrame(analyzeAudio);
        } else {
          console.log('=== MICROPHONE TEST RESULTS ===');
          console.log(`Max audio level: ${maxLevel}/255`);
          console.log(`Average samples per second: ${sampleCount / (testDuration / 1000)}`);
          console.log(`Final RMS: ${rms.toFixed(6)}`);
          
          setStatus(`Microphone test complete. Max level: ${maxLevel}/255`);
          
          // Clean up
          stream.getTracks().forEach(track => track.stop());
          audioContext.close();
        }
      };
      
      analyzeAudio();
      
    } catch (err) {
      setError('Microphone test failed: ' + (err instanceof Error ? err.message : String(err)));
      setStatus('Error');
    }
  };

  // Start recording
  const handleStart = async () => {
    setTranscript('');
    setStatus('Listening...');
    setError(null);
    setChatResponse('');
    framesRef.current = [];
    setRecording(true);
    
    try {
      // Set up audio visualization with selected device
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
        } 
      });
      
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
      
      const vad = recordAndDetectVoice({ 
        sampleRate: 16000, 
        sensitivity: 2, 
        frameDuration: 30,
        deviceId: selectedDeviceId 
      });
      console.log('Starting VAD loop...');
      let frameCount = 0;
      let stopRequested = false;
      let lastSpeechFrame = 0;
      const minFrames = 5; // Minimum frames to collect
      const maxFrames = 100; // Maximum frames to prevent infinite recording
      const speechTimeout = 20; // Continue recording for 20 frames after last speech
      
      for await (const { frame } of vad) {
        console.log('VAD loop: received frame, recording =', recording);
        console.log('VAD loop: pushing frame to framesRef');
        framesRef.current.push(frame);
        frameCount++;
        lastSpeechFrame = frameCount;
        setSpeechDetected(true); // Speech is being detected
        console.log('VAD loop: frame pushed, total frames =', framesRef.current.length);
        
        // Add a small delay to ensure frames are collected
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Update stop requested flag
        if (!recording && !stopRequested) {
          stopRequested = true;
          console.log('VAD loop: stop requested, continuing to collect speech frames...');
        }
        
        // Stop conditions:
        // 1. Stop was requested AND we have minimum frames AND enough silence
        // 2. We've collected maximum frames
        if ((stopRequested && frameCount >= minFrames && (frameCount - lastSpeechFrame) >= speechTimeout) || 
            frameCount >= maxFrames) {
          console.log('VAD loop: stopping recording - frames:', frameCount, 'last speech:', lastSpeechFrame);
          break;
        }
      }
      
      setSpeechDetected(false); // No more speech detected
      console.log('VAD loop: finished, total frames collected =', framesRef.current.length);
      
      // Clean up audio visualization
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      stream.getTracks().forEach(track => track.stop());
    } catch (err) {
      setError('Microphone error: ' + (err instanceof Error ? err.message : String(err)));
      setRecording(false);
      setStatus('Error');
    }
  };

  // Stop recording and send to ASR
  const handleStop = async () => {
    setRecording(false);
    setStatus('Transcribing...');
    try {
      // Debug: Log the number of PCM frames
      console.log('Number of PCM frames:', framesRef.current.length);
      // Debug: Log frame data to check if it's changing
      if (framesRef.current.length > 0) {
        const firstFrame = framesRef.current[0];
        const lastFrame = framesRef.current[framesRef.current.length - 1];
        console.log('First frame size:', firstFrame.byteLength);
        console.log('Last frame size:', lastFrame.byteLength);
        console.log('First frame first 4 bytes:', new Uint8Array(firstFrame.slice(0, 4)));
        console.log('Last frame first 4 bytes:', new Uint8Array(lastFrame.slice(0, 4)));
      }
      const wavBlob = pcmToWav(framesRef.current, 16000);
      // Debug: Log WAV blob details
      console.log('WAV Blob created:', {
        size: wavBlob.size,
        type: wavBlob.type,
        lastModified: Date.now()
      });
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      // Debug: Log the API key
      console.log('API KEY (ASR):', process.env.REACT_APP_OPENAI_API_KEY);
      // Debug: Log the WAV Blob size
      console.log('WAV Blob size:', wavBlob.size);
      // Debug: Log FormData contents
      Array.from(formData.entries()).forEach(pair => {
        console.log('FormData entry:', pair[0], pair[1]);
      });
      // Debug: Log request details
      console.log('Sending ASR request to:', ASR_API_URL);
      console.log('Request timestamp:', new Date().toISOString());
      const resp = await fetch(ASR_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_OPENAI_API_KEY || ''}`
        },
        body: formData
      });
      if (!resp.ok) {
        const data = await resp.json();
        console.log('ASR error response:', data);
        throw new Error('ASR failed: ' + resp.statusText);
      }
      const data = await resp.json();
      // Debug: Log the full response
      console.log('ASR success response:', data);
      console.log('Response timestamp:', new Date().toISOString());
      setTranscript(data.text || '(No transcript)');
      setStatus('Transcript ready');
    } catch (err) {
      setError('ASR error: ' + (err instanceof Error ? err.message : String(err)));
      setStatus('Error');
    }
  };

  // Send transcript to chatbot
  const handleChat = async () => {
    setChatLoading(true);
    setChatResponse('');
    setStatus('Chatting...');
    setError(null);
    try {
      // Debug: Log the API key
      console.log('API KEY (CHAT):', process.env.REACT_APP_OPENAI_API_KEY);
      const resp = await fetch(CHAT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.REACT_APP_OPENAI_API_KEY || ''}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are a helpful, empathetic voice companion.' },
            { role: 'user', content: transcript }
          ]
        })
      });
      if (!resp.ok) throw new Error('Chatbot failed: ' + resp.statusText);
      const data = await resp.json();
      setChatResponse(data.choices?.[0]?.message?.content || '(No response)');
      setStatus('Done');
    } catch (err) {
      setError('Chatbot error: ' + (err instanceof Error ? err.message : String(err)));
      setStatus('Error');
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: '2rem auto', padding: 24, border: '1px solid #ccc', borderRadius: 8 }}>
      <h2>Solace Lite Voice Companion Demo</h2>
      
      {/* Device Selection */}
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="device-select"><b>Microphone:</b></label>
        <select 
          id="device-select"
          value={selectedDeviceId} 
          onChange={(e) => setSelectedDeviceId(e.target.value)}
          style={{ marginLeft: 8, padding: 4 }}
          disabled={recording}
        >
          {audioDevices.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Microphone ${device.deviceId.slice(0, 8)}...`}
            </option>
          ))}
        </select>
      </div>
      
      <div style={{ marginBottom: 16 }}>
        <button onClick={handleStart} disabled={recording}>Talk</button>
        <button onClick={handleStop} disabled={!recording}>Stop</button>
        <button onClick={handleChat} disabled={!transcript || chatLoading}>Send to Chatbot</button>
        <button onClick={handleTestMicrophone} disabled={recording}>Test Microphone</button>
      </div>
      <div><b>Status:</b> {status}</div>
      {error && <div style={{ color: 'red' }}><b>Error:</b> {error}</div>}
      
      {/* Audio Level Visualization */}
      {recording && (
        <div style={{ marginTop: 16 }}>
          <b>Audio Level:</b>
          <div style={{ 
            width: '100%', 
            height: 20, 
            backgroundColor: '#f0f0f0', 
            borderRadius: 4,
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${(audioLevel / 255) * 100}%`,
              height: '100%',
              backgroundColor: audioLevel > 50 ? '#4CAF50' : '#FFC107',
              transition: 'width 0.1s ease'
            }} />
          </div>
          <small>Level: {audioLevel} / 255</small>
        </div>
      )}
      
      {/* Speech Detection Indicator */}
      {recording && (
        <div style={{ marginTop: 8 }}>
          <b>Speech Detection:</b>
          <div style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: speechDetected ? '#4CAF50' : '#ccc',
            marginLeft: 8,
            transition: 'background-color 0.2s ease'
          }} />
          <small style={{ marginLeft: 4 }}>
            {speechDetected ? 'Detecting speech...' : 'Listening...'}
          </small>
        </div>
      )}
      
      <div style={{ marginTop: 24 }}>
        <b>Transcript:</b>
        <div style={{ background: '#f7f7f7', padding: 12, borderRadius: 4, minHeight: 32 }}>{transcript}</div>
      </div>
      <div style={{ marginTop: 24 }}>
        <b>Chatbot Response:</b>
        <div style={{ background: '#e8f5e8', padding: 12, borderRadius: 4, minHeight: 32 }}>{chatResponse}</div>
      </div>
    </div>
  );
};

export default App;

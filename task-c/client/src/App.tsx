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
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 25%, #a5d6a7 50%, #81c784 75%, #66bb6a 100%)',
      fontFamily: '"Fredoka One", "Comic Sans MS", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Nature Background Elements */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        zIndex: 0
      }}>
        {/* Floating leaves */}
        <div style={{
          position: 'absolute',
          top: '10%',
          left: '5%',
          fontSize: '48px',
          color: 'rgba(76, 175, 80, 0.4)',
          animation: 'float 8s ease-in-out infinite',
          transform: 'rotate(15deg)',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))'
        }}>🍃</div>
        <div style={{
          position: 'absolute',
          top: '20%',
          right: '10%',
          fontSize: '40px',
          color: 'rgba(76, 175, 80, 0.5)',
          animation: 'float 10s ease-in-out infinite reverse',
          transform: 'rotate(-20deg)',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))'
        }}>🌿</div>
        <div style={{
          position: 'absolute',
          bottom: '15%',
          left: '15%',
          fontSize: '36px',
          color: 'rgba(76, 175, 80, 0.4)',
          animation: 'float 9s ease-in-out infinite',
          transform: 'rotate(45deg)',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))'
        }}>🍃</div>
        <div style={{
          position: 'absolute',
          bottom: '25%',
          right: '5%',
          fontSize: '44px',
          color: 'rgba(76, 175, 80, 0.5)',
          animation: 'float 11s ease-in-out infinite reverse',
          transform: 'rotate(-30deg)',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))'
        }}>🌿</div>
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          fontSize: '52px',
          color: 'rgba(76, 175, 80, 0.3)',
          animation: 'float 12s ease-in-out infinite',
          transform: 'translate(-50%, -50%) rotate(60deg)',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))'
        }}>🍃</div>
      </div>

      {/* Main Content */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        maxWidth: 900,
        margin: '0 auto',
        padding: '2rem',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }}>
        {/* Header */}
        <div style={{
          textAlign: 'center',
          marginBottom: '3rem'
        }}>
          <div style={{
            fontSize: '4rem',
            marginBottom: '0.5rem',
            color: '#2e7d32',
            fontWeight: 'bold',
            textShadow: '0 4px 8px rgba(0,0,0,0.3), 0 0 20px rgba(76,175,80,0.3)',
            animation: 'glow 3s ease-in-out infinite alternate'
          }}>
            🍀 Solace
          </div>
          <div style={{
            fontSize: '1.4rem',
            color: '#1b5e20',
            marginBottom: '1rem',
            fontWeight: '400',
            textShadow: '0 2px 4px rgba(0,0,0,0.2)'
          }}>
            Your AI Companion for Emotional Wellness
          </div>
          <div style={{
            width: '80px',
            height: '4px',
            background: 'linear-gradient(90deg, #2e7d32, #4caf50)',
            margin: '0 auto',
            borderRadius: '2px',
            boxShadow: '0 2px 8px rgba(76,175,80,0.3)'
          }}></div>
        </div>

        {/* Main Card */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.25)',
          borderRadius: '25px',
          padding: '3rem',
          boxShadow: '0 25px 50px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
          border: '3px solid rgba(76, 175, 80, 0.4)',
          backdropFilter: 'blur(20px)'
        }}>
          {/* Device Selection */}
          <div style={{
            marginBottom: '2rem',
            padding: '2rem',
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.2) 100%)',
            borderRadius: '20px',
            border: '3px solid rgba(76, 175, 80, 0.5)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: '1rem'
            }}>
              <span style={{
                fontSize: '1.5rem',
                marginRight: '0.8rem',
                color: '#2e7d32',
                animation: 'pulse 2s ease-in-out infinite'
              }}>🎤</span>
              <label style={{
                fontWeight: '600',
                color: '#1b5e20',
                fontSize: '1.2rem',
                textShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}>
                Microphone Selection
              </label>
            </div>
            <select 
              value={selectedDeviceId} 
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              style={{
                width: '100%',
                padding: '1rem',
                borderRadius: '15px',
                border: '3px solid rgba(76, 175, 80, 0.6)',
                background: 'rgba(255, 255, 255, 0.2)',
                fontSize: '1rem',
                color: '#1b5e20',
                outline: 'none',
                transition: 'all 0.3s ease',
                cursor: 'pointer',
                backdropFilter: 'blur(10px)',
                fontWeight: '500'
              }}
              disabled={recording}
            >
              {audioDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId} style={{ background: '#e8f5e8' }}>
                  {device.label || `Microphone ${device.deviceId.slice(0, 8)}...`}
                </option>
              ))}
            </select>
          </div>

          {/* Controls */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1.5rem',
            marginBottom: '2rem'
          }}>
            <button 
              onClick={handleStart} 
              disabled={recording}
              style={{
                padding: '1.2rem 1.8rem',
                borderRadius: '20px',
                border: 'none',
                background: recording ? 'rgba(255, 255, 255, 0.2)' : 'linear-gradient(135deg, #4caf50 0%, #66bb6a 50%, #81c784 100%)',
                color: recording ? '#9e9e9e' : '#ffffff',
                fontSize: '1.1rem',
                fontWeight: '700',
                cursor: recording ? 'not-allowed' : 'pointer',
                transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                boxShadow: recording ? 'none' : '0 12px 30px rgba(76, 175, 80, 0.5), inset 0 1px 0 rgba(255,255,255,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.8rem',
                position: 'relative',
                overflow: 'hidden',
                textShadow: '0 2px 4px rgba(0,0,0,0.3)'
              }}
            >
              <span style={{ 
                fontSize: '1.4rem',
                animation: recording ? 'spin 2s linear infinite' : 'bounce 2s ease-in-out infinite'
              }}>🎙️</span>
              {recording ? 'Recording...' : 'Start Talking'}
            </button>
            
            <button 
              onClick={handleStop} 
              disabled={!recording}
              style={{
                padding: '1.2rem 1.8rem',
                borderRadius: '20px',
                border: 'none',
                background: !recording ? 'rgba(255, 255, 255, 0.2)' : 'linear-gradient(135deg, #f44336 0%, #ef5350 50%, #e57373 100%)',
                color: !recording ? '#9e9e9e' : '#ffffff',
                fontSize: '1.1rem',
                fontWeight: '700',
                cursor: !recording ? 'not-allowed' : 'pointer',
                transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                boxShadow: !recording ? 'none' : '0 12px 30px rgba(244, 67, 54, 0.5), inset 0 1px 0 rgba(255,255,255,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.8rem',
                textShadow: '0 2px 4px rgba(0,0,0,0.3)'
              }}
            >
              <span style={{ 
                fontSize: '1.4rem',
                animation: !recording ? 'none' : 'pulse 1s ease-in-out infinite'
              }}>⏹️</span>
              Stop Recording
            </button>
            
            <button 
              onClick={handleChat} 
              disabled={!transcript || chatLoading}
              style={{
                padding: '1.2rem 1.8rem',
                borderRadius: '20px',
                border: 'none',
                background: (!transcript || chatLoading) ? 'rgba(255, 255, 255, 0.2)' : 'linear-gradient(135deg, #2196f3 0%, #42a5f5 50%, #64b5f6 100%)',
                color: (!transcript || chatLoading) ? '#9e9e9e' : '#ffffff',
                fontSize: '1.1rem',
                fontWeight: '700',
                cursor: (!transcript || chatLoading) ? 'not-allowed' : 'pointer',
                transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                boxShadow: (!transcript || chatLoading) ? 'none' : '0 12px 30px rgba(33, 150, 243, 0.5), inset 0 1px 0 rgba(255,255,255,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.8rem',
                textShadow: '0 2px 4px rgba(0,0,0,0.3)'
              }}
            >
              <span style={{ 
                fontSize: '1.4rem',
                animation: chatLoading ? 'spin 1s linear infinite' : 'wiggle 3s ease-in-out infinite'
              }}>💬</span>
              {chatLoading ? 'Thinking...' : 'Send to Chatbot'}
            </button>
          </div>

          {/* Status and Test Microphone - Same level, same size */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '1.5rem',
            marginBottom: '2rem'
          }}>
            {/* Status Box */}
            <div style={{
              padding: '1.2rem 1.8rem',
              background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.2) 100%)',
              borderRadius: '20px',
              border: '3px solid rgba(76, 175, 80, 0.5)',
              textAlign: 'center',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '220px',
              height: '60px',
              boxSizing: 'border-box'
            }}>
              <div style={{
                fontSize: '1rem',
                color: '#1b5e20',
                fontWeight: '600',
                textShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}>
                Status: {status}
              </div>
            </div>

            {/* Test Microphone Button */}
            <button 
              onClick={handleTestMicrophone} 
              disabled={recording}
              style={{
                padding: '1.2rem 1.8rem',
                borderRadius: '20px',
                border: 'none',
                background: recording ? 'rgba(255, 255, 255, 0.2)' : 'linear-gradient(135deg, #ff9800 0%, #ffb74d 50%, #ffcc80 100%)',
                color: recording ? '#9e9e9e' : '#ffffff',
                fontSize: '1.1rem',
                fontWeight: '700',
                cursor: recording ? 'not-allowed' : 'pointer',
                transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                boxShadow: recording ? 'none' : '0 12px 30px rgba(255, 152, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.8rem',
                textShadow: '0 2px 4px rgba(0,0,0,0.3)',
                width: '220px',
                height: '60px',
                boxSizing: 'border-box'
              }}
            >
              <span style={{ 
                fontSize: '1.4rem',
                animation: recording ? 'none' : 'shake 2s ease-in-out infinite'
              }}>🎯</span>
              Test Microphone
            </button>
          </div>

          {/* Audio Visualization */}
          {recording && (
            <div style={{
              marginBottom: '2rem',
              padding: '2rem',
              background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.2) 100%)',
              borderRadius: '20px',
              border: '3px solid rgba(76, 175, 80, 0.5)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: '1.5rem'
              }}>
                <span style={{
                  fontSize: '1.5rem',
                  marginRight: '0.8rem',
                  color: '#2e7d32',
                  animation: 'pulse 1.5s ease-in-out infinite'
                }}>📊</span>
                <span style={{
                  fontWeight: '600',
                  color: '#1b5e20',
                  fontSize: '1.2rem',
                  textShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}>
                  Audio Level
                </span>
              </div>
              
              <div style={{
                width: '100%',
                height: '30px',
                background: 'rgba(255, 255, 255, 0.3)',
                borderRadius: '15px',
                overflow: 'hidden',
                border: '3px solid rgba(76, 175, 80, 0.6)',
                position: 'relative'
              }}>
                <div style={{
                  width: `${(audioLevel / 255) * 100}%`,
                  height: '100%',
                  background: audioLevel > 50 ? 'linear-gradient(90deg, #4caf50, #66bb6a)' : 'linear-gradient(90deg, #ff9800, #ffb74d)',
                  transition: 'width 0.1s ease',
                  borderRadius: '12px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                }} />
              </div>
              
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '1rem',
                fontSize: '0.9rem',
                color: '#1b5e20',
                textShadow: '0 2px 4px rgba(0,0,0,0.2)',
                fontWeight: '500'
              }}>
                <span>Level: {audioLevel} / 255</span>
                <span style={{
                  animation: speechDetected ? 'pulse 1s ease-in-out infinite' : 'none'
                }}>
                  {speechDetected ? '🎤 Detecting speech...' : '👂 Listening...'}
                </span>
              </div>
            </div>
          )}

          {/* Transcript and Response */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
            gap: '2.5rem'
          }}>
            {/* Transcript */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.2) 100%)',
              borderRadius: '20px',
              padding: '2rem',
              border: '3px solid rgba(76, 175, 80, 0.5)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: '1.5rem'
              }}>
                <span style={{
                  fontSize: '1.5rem',
                  marginRight: '0.8rem',
                  color: '#2e7d32',
                  animation: 'bounce 2s ease-in-out infinite'
                }}>📝</span>
                <span style={{
                  fontWeight: '600',
                  color: '#1b5e20',
                  fontSize: '1.2rem',
                  textShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}>
                  Your Message
                </span>
              </div>
              <div style={{
                background: 'rgba(255, 255, 255, 0.2)',
                padding: '1.5rem',
                borderRadius: '15px',
                minHeight: '120px',
                border: '3px solid rgba(76, 175, 80, 0.4)',
                fontSize: '1rem',
                color: '#1b5e20',
                lineHeight: '1.6',
                backdropFilter: 'blur(10px)',
                fontWeight: '500'
              }}>
                {transcript || 'Your transcribed speech will appear here...'}
              </div>
            </div>

            {/* Chatbot Response */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(33, 150, 243, 0.3) 0%, rgba(156, 39, 176, 0.3) 100%)',
              borderRadius: '20px',
              padding: '2rem',
              border: '3px solid rgba(76, 175, 80, 0.5)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: '1.5rem'
              }}>
                <span style={{
                  fontSize: '1.5rem',
                  marginRight: '0.8rem',
                  color: '#2e7d32',
                  animation: 'wiggle 3s ease-in-out infinite'
                }}>🤖</span>
                <span style={{
                  fontWeight: '600',
                  color: '#1b5e20',
                  fontSize: '1.2rem',
                  textShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}>
                  Your Solace's Response
                </span>
              </div>
              <div style={{
                background: 'rgba(255, 255, 255, 0.2)',
                padding: '1.5rem',
                borderRadius: '15px',
                minHeight: '120px',
                border: '3px solid rgba(76, 175, 80, 0.4)',
                fontSize: '1rem',
                color: '#1b5e20',
                lineHeight: '1.6',
                backdropFilter: 'blur(10px)',
                fontWeight: '500'
              }}>
                {chatResponse || 'Your Solace\'s response will appear here...'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka+One:wght@400&display=swap');
        
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(15deg); }
          50% { transform: translateY(-30px) rotate(15deg); }
        }
        
        @keyframes glow {
          0% { text-shadow: 0 4px 8px rgba(0,0,0,0.3), 0 0 20px rgba(76,175,80,0.3); }
          100% { text-shadow: 0 4px 8px rgba(0,0,0,0.3), 0 0 30px rgba(76,175,80,0.6); }
        }
        
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        
        @keyframes bounce {
          0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-10px); }
          60% { transform: translateY(-5px); }
        }
        
        @keyframes wiggle {
          0%, 7% { transform: rotateZ(0); }
          15% { transform: rotateZ(-15deg); }
          20% { transform: rotateZ(10deg); }
          25% { transform: rotateZ(-10deg); }
          30% { transform: rotateZ(6deg); }
          35% { transform: rotateZ(-4deg); }
          40%, 100% { transform: rotateZ(0); }
        }
        
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
          20%, 40%, 60%, 80% { transform: translateX(5px); }
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        select:hover {
          border-color: #4caf50 !important;
          box-shadow: 0 8px 25px rgba(76, 175, 80, 0.4) !important;
          transform: translateY(-2px);
        }
        
        button:hover:not(:disabled) {
          transform: translateY(-4px) scale(1.02);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3) !important;
        }
        
        button:active:not(:disabled) {
          transform: translateY(-2px) scale(0.98);
        }
      `}</style>
    </div>
  );
};

export default App;

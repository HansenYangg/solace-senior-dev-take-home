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

// TTS utility function (uses local proxy server)
// NOTE: The local Polly proxy (polly-proxy.js) must be running for TTS to work.
async function synthesizeSpeech(text: string, voiceId: string = 'Nicole'): Promise<string | null> {
  try {
    const resp = await fetch('http://localhost:5000/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId }),
    });
    if (!resp.ok) throw new Error('TTS failed: ' + resp.statusText);
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    alert('TTS error: ' + (err instanceof Error ? err.message : String(err)));
    return null;
  }
}

const ASR_API_URL = process.env.REACT_APP_ASR_API_URL || 'https://api.openai.com/v1/audio/transcriptions';
const CHAT_API_URL = process.env.REACT_APP_CHAT_API_URL || 'https://api.openai.com/v1/chat/completions';

// Add type for conversation exchange
interface ChatExchange {
  user: string;
  ai: string;
}

const App: React.FC = () => {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [chatResponse, setChatResponse] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [speechDetected, setSpeechDetected] = useState(false);
  const framesRef = useRef<ArrayBuffer[]>([]);
  const vadIteratorRef = useRef<AsyncIterableIterator<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [messages, setMessages] = useState<{role: 'user'|'solace', text: string}[]>([]);
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Add state for selected voice
  const [selectedVoice, setSelectedVoice] = useState<'Aria' | 'Matthew'>('Aria');
  // Add state for conversation history
  const [exchanges, setExchanges] = useState<ChatExchange[]>([]);

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

  // Start recording
  const handleStart = async () => {
    setTranscript('');
    setStatus('Listening...');
    setError(null);
    setChatResponse('');
    setPendingTranscript(null); // Clear preview bubble when starting new recording
    framesRef.current = [];
    setRecording(true);
    
    try {
      // Ensure audio context is properly initialized
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (analyserRef.current) {
        analyserRef.current = null;
      }
      
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
      
      // Create audio context for visualization
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
      
      let frameCount = 0;
      let stopRequested = false;
      let lastSpeechFrame = 0;
      const minFrames = 5; // Minimum frames to collect
      const maxFrames = 100; // Maximum frames to prevent infinite recording
      const speechTimeout = 20; // Continue recording for 20 frames after last speech
      
      for await (const { frame } of vad) {
        framesRef.current.push(frame);
        frameCount++;
        lastSpeechFrame = frameCount;
        setSpeechDetected(true); // Speech is being detected
        
        // Add a small delay to ensure frames are collected
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Update stop requested flag
        if (!recording && !stopRequested) {
          stopRequested = true;
        }
        
        // Stop conditions:
        // 1. Stop was requested AND we have minimum frames AND enough silence
        // 2. We've collected maximum frames
        if ((stopRequested && frameCount >= minFrames && (frameCount - lastSpeechFrame) >= speechTimeout) || 
            frameCount >= maxFrames) {
          break;
        }
      }
      
      setSpeechDetected(false); // No more speech detected
      
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
      
      // Clean up on error
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      analyserRef.current = null;
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
      // Check for API key before making request
      const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
      if (!apiKey) {
        setError('No OpenAI API key provided. Please set your API key.');
        setStatus('Error');
        return;
      }
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
          Authorization: `Bearer ${apiKey}`
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
  const handleChat = async (userTranscript: string) => {
    if (!userTranscript || !userTranscript.trim()) {
      setError('Transcript is empty.');
      return;
    }
    // Check for API key before making request
    const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
    if (!apiKey) {
      setError('No OpenAI API key provided. Please set your API key.');
      setStatus('Error');
      return;
    }
    setChatLoading(true);
    setChatResponse('');
    setStatus('Chatting...');
    setError(null);
    try {
      // System prompt for warmth/support
      const systemPrompt =
        "You are Solace, an emotional companion and supportive friend. You are warm, empathetic, and always there to listen and help. Respond in a caring, conversational, and non-robotic way. Respond directly to the user's latest message, but use the conversation history for context if needed. Avoid repeating the history verbatim.";
      // Build messages array for OpenAI chat API
      // Only include the last 5 exchanges
      const lastExchanges = exchanges.slice(-5);
      const messages = [
        { role: 'system', content: systemPrompt },
        ...lastExchanges.flatMap(ex => [
          { role: 'user', content: ex.user },
          { role: 'assistant', content: ex.ai }
        ]),
        { role: 'user', content: userTranscript }
      ];
      const resp = await fetch(CHAT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages
        })
      });
      if (!resp.ok) throw new Error('Chatbot failed: ' + resp.statusText);
      const data = await resp.json();
      const aiReply = data.choices?.[0]?.message?.content || '(No response)';
      setChatResponse(aiReply);
      // Add new exchange to history (max 5)
      setExchanges(prev => {
        const updated = [...prev, { user: userTranscript, ai: aiReply }];
        return updated.slice(-5);
      });
      setStatus('Done');
    } catch (err) {
      setError('Chatbot error: ' + (err instanceof Error ? err.message : String(err)));
      setStatus('Error');
    } finally {
      setChatLoading(false);
    }
  };

  // Test microphone
  const handleTestMicrophone = async () => {
    setStatus('Testing microphone...');
    setError(null);
    try {
      // List all audio devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
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
      // Just test if we can access the mic and stop
      stream.getTracks().forEach(track => track.stop());
      setStatus('Microphone test complete.');
    } catch (err) {
      setError('Microphone test failed: ' + (err instanceof Error ? err.message : String(err)));
      setStatus('Error');
    }
  };

  // When transcript updates, show preview bubble only (do not add to chat)
  useEffect(() => {
    if (transcript) {
      setPendingTranscript(transcript);
    }
  }, [transcript]);
  // When chatResponse updates, add to chat log
  useEffect(() => {
    if (chatResponse) {
      setMessages((msgs) => [...msgs, { role: 'solace', text: chatResponse }]);
    }
  }, [chatResponse]);

  // Update handleSendTranscript to add user message, clear preview, and trigger AI
  const handleSendTranscript = () => {
    if (pendingTranscript && pendingTranscript.trim()) {
      setMessages((msgs) => [...msgs, { role: 'user', text: pendingTranscript }]);
      setTranscript(pendingTranscript);
      setPendingTranscript(null);
      handleChat(pendingTranscript); // Pass the transcript to the AI
    }
  };

  // Play TTS for latest AI message
  const handlePlayTTS = async () => {
    const lastSolaceMsg = messages.filter(m => m.role === 'solace').slice(-1)[0];
    if (!lastSolaceMsg) return;
    setTtsAudioUrl(null);
    const voiceId = selectedVoice; // Use Aria or Matthew
    const url = await synthesizeSpeech(lastSolaceMsg.text, voiceId);
    if (url) {
      setTtsAudioUrl(url);
      setTimeout(() => {
        audioRef.current?.play();
      }, 100);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 25%, #a5d6a7 50%, #81c784 75%, #66bb6a 100%)',
      fontFamily: '"Fredoka One", "Comic Sans MS", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Floating leaves background */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        zIndex: 0
      }}>
        <div style={{ position: 'absolute', top: '10%', left: '5%', fontSize: '48px', color: 'rgba(76, 175, 80, 0.4)', animation: 'float 8s ease-in-out infinite', transform: 'rotate(15deg)', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}>🍃</div>
        <div style={{ position: 'absolute', top: '20%', right: '10%', fontSize: '40px', color: 'rgba(76, 175, 80, 0.5)', animation: 'float 10s ease-in-out infinite reverse', transform: 'rotate(-20deg)', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}>🌿</div>
        <div style={{ position: 'absolute', bottom: '15%', left: '15%', fontSize: '36px', color: 'rgba(76, 175, 80, 0.4)', animation: 'float 9s ease-in-out infinite', transform: 'rotate(45deg)', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}>🍃</div>
        <div style={{ position: 'absolute', bottom: '25%', right: '5%', fontSize: '44px', color: 'rgba(76, 175, 80, 0.5)', animation: 'float 11s ease-in-out infinite reverse', transform: 'rotate(-30deg)', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}>🌿</div>
        <div style={{ position: 'absolute', top: '50%', left: '50%', fontSize: '52px', color: 'rgba(76, 175, 80, 0.3)', animation: 'float 12s ease-in-out infinite', transform: 'translate(-50%, -50%) rotate(60deg)', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}>🍃</div>
      </div>

      {/* Mic dropdown at top left */}
      <div style={{
        position: 'absolute',
        top: 24,
        left: 24,
        zIndex: 2,
        minWidth: 340,
        maxWidth: 420,
        background: 'rgba(255,255,255,0.22)',
        borderRadius: '16px',
        padding: '0.8rem 1.2rem 0.8rem 1.2rem',
        boxShadow: '0 8px 32px rgba(0,0,0,0.13)',
        border: '2.5px solid rgba(76, 175, 80, 0.22)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        height: 'fit-content',
      }}>
        <div style={{
          fontSize: '1.13rem',
          fontWeight: 600,
          color: '#1b5e20',
          marginBottom: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}>
          <span role="img" aria-label="mic">🎤</span> Mic
        </div>
        <select 
          value={selectedDeviceId} 
          onChange={(e) => setSelectedDeviceId(e.target.value)}
          style={{
            width: '100%',
            padding: '0.6rem',
            borderRadius: '10px',
            border: '2.5px solid rgba(76, 175, 80, 0.35)',
            background: 'rgba(255,255,255,0.28)',
            fontSize: '1.05rem',
            color: '#1b5e20',
            outline: 'none',
            marginBottom: '0.7rem',
            fontWeight: 500,
          }}
          disabled={recording}
        >
          {audioDevices.map(device => (
            <option key={device.deviceId} value={device.deviceId} style={{ background: '#e8f5e8' }}>
              {device.label || `Microphone ${device.deviceId.slice(0, 8)}...`}
            </option>
          ))}
        </select>
        <button 
          onClick={handleTestMicrophone} 
          disabled={recording}
          style={{
            padding: '0.7rem 1.2rem',
            borderRadius: '12px',
            border: 'none',
            background: recording ? 'rgba(255, 255, 255, 0.2)' : 'linear-gradient(135deg, #ff9800 0%, #ffb74d 50%, #ffcc80 100%)',
            color: recording ? '#9e9e9e' : '#ffffff',
            fontSize: '1.05rem',
            fontWeight: '700',
            cursor: recording ? 'not-allowed' : 'pointer',
            marginTop: '0.2rem',
            marginBottom: '0.2rem',
            boxShadow: recording ? 'none' : '0 8px 24px rgba(255, 152, 0, 0.18)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            filter: 'brightness(1.08) drop-shadow(0 2px 8px #ffb74d88)',
          }}
        >
          <span style={{ fontSize: '1.15rem' }}>🎯</span> Test
        </button>
      </div>

      {/* Voice Selection Dropdown */}
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.2rem',
        marginBottom: '1.2rem',
        marginTop: '0.5rem',
      }}>
        <label style={{ fontWeight: 600, color: '#2e7d32', fontSize: '1.13rem' }}>
          Voice:
          <select
            value={selectedVoice}
            onChange={e => setSelectedVoice(e.target.value as 'Aria' | 'Matthew')}
            style={{
              marginLeft: '0.7rem',
              padding: '0.6rem 1.2rem',
              borderRadius: '12px',
              border: '2.5px solid #2196f3',
              background: 'rgba(255,255,255,0.28)',
              fontSize: '1.13rem',
              color: '#1b5e20',
              fontWeight: 600,
              outline: 'none',
              minWidth: '120px',
              boxShadow: '0 2px 8px rgba(33,150,243,0.08)',
            }}
          >
            <option value="Aria">Aria (Girl)</option>
            <option value="Matthew">Matthew (Boy)</option>
          </select>
        </label>
      </div>

      {/* Centered chat box */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        margin: '0 auto',
        marginTop: '2.5rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '88vh',
        height: '88vh',
        maxWidth: 700,
        width: '100%',
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.72)',
          borderRadius: '32px',
          boxShadow: '0 32px 64px rgba(0, 0, 0, 0.18), 0 2px 0 rgba(255, 255, 255, 0.18)',
          border: '3.5px solid #2e7d32',
          padding: '2.5rem 2.2rem 1.5rem 2.2rem',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          backdropFilter: 'blur(18px)',
        }}>
          {/* Header */}
          <div style={{
            textAlign: 'center',
            marginBottom: '1.2rem',
          }}>
            <div style={{
              fontSize: '2.2rem',
              color: '#2e7d32',
              fontWeight: 'bold',
              textShadow: '0 4px 8px rgba(0,0,0,0.13), 0 0 20px rgba(76,175,80,0.13)',
              animation: 'glow 3s ease-in-out infinite alternate',
              marginBottom: '0.1rem',
            }}>
              🍀 Solace
            </div>
            <div style={{
              fontSize: '1.13rem',
              color: '#1b5e20',
              fontWeight: '400',
              textShadow: '0 2px 4px rgba(0,0,0,0.08)',
            }}>
              Your AI Companion for Emotional Wellness
            </div>
          </div>
          {/* Chat Log */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.1rem',
            marginBottom: '1.2rem',
            width: '100%',
            maxWidth: '100%',
          }}>
            {messages.length === 0 && (
              <div style={{ color: '#888', textAlign: 'center', marginTop: '2rem', fontSize: '1.1rem' }}>
                Start a conversation with Solace!
              </div>
            )}
            {messages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '90%',
                  minWidth: '60px',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  whiteSpace: 'pre-wrap',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, rgba(33, 150, 243, 0.92) 0%, rgba(66, 165, 245, 0.92) 100%)'
                    : 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(220,220,220,0.92) 100%)',
                  color: msg.role === 'user' ? '#fff' : '#1b5e20',
                  borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  padding: '1.1rem 1.3rem',
                  marginBottom: '0.1rem',
                  fontWeight: 500,
                  fontSize: '1.13rem',
                  boxShadow: msg.role === 'user'
                    ? '0 2px 16px 0 rgba(33,150,243,0.13), 0 2px 0 rgba(255,255,255,0.18)'
                    : '0 2px 16px 0 rgba(180,180,180,0.13), 0 2px 0 rgba(255,255,255,0.18)',
                  position: 'relative',
                  backdropFilter: 'blur(10px)',
                }}
              >
                {msg.role === 'solace' && (
                  <span style={{ position: 'absolute', left: '-2.2rem', top: '0.2rem', fontSize: '1.3rem' }}>🤖</span>
                )}
                {msg.role === 'user' && (
                  <span style={{ position: 'absolute', right: '-2.2rem', top: '0.2rem', fontSize: '1.3rem' }}>🧑‍💻</span>
                )}
                {msg.text}
              </div>
            ))}
            {/* Pending transcript preview bubble */}
            {pendingTranscript && (
              <div
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '90%',
                  minWidth: '60px',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  whiteSpace: 'pre-wrap',
                  background: 'linear-gradient(135deg, rgba(33, 150, 243, 0.98) 0%, rgba(66, 165, 245, 0.98) 100%)',
                  color: '#fff',
                  borderRadius: '18px 18px 4px 18px',
                  padding: '1.1rem 1.3rem',
                  marginBottom: '0.1rem',
                  fontWeight: 600,
                  fontSize: '1.13rem',
                  boxShadow: '0 2px 20px 0 rgba(33,150,243,0.18), 0 2px 0 rgba(255,255,255,0.22)',
                  position: 'relative',
                  backdropFilter: 'blur(12px)',
                  border: '2.5px solid #2196f3',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.7rem',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '1.08rem', marginBottom: '0.3rem' }}>
                  Here's what you said in your latest voice recording:
                </span>
                <span style={{ fontStyle: 'italic', fontWeight: 500, fontSize: '1.13rem', color: '#e3f2fd' }}>
                  "{pendingTranscript}"
                </span>
                <span style={{ fontWeight: 500, fontSize: '1.01rem', color: '#e3f2fd', marginBottom: '0.2rem' }}>
                  Click <b>Send</b> if you would like to send this to your Solace!
                </span>
              </div>
            )}
          </div>
          {/* Controls */}
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            gap: '1.2rem',
            alignItems: 'center',
            marginTop: '0.5rem',
            justifyContent: 'center', // Add this line to center the buttons
            width: '100%', // Ensure it takes full width
          }}>
            <button 
              onClick={handleStart} 
              disabled={recording}
              style={{
                padding: '1.2rem 2.1rem',
                borderRadius: '22px',
                border: 'none',
                background: recording ? 'rgba(255, 255, 255, 0.2)' : 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)',
                color: recording ? '#9e9e9e' : '#ffffff',
                fontSize: '1.13rem',
                fontWeight: '700',
                cursor: recording ? 'not-allowed' : 'pointer',
                boxShadow: recording ? 'none' : '0 16px 36px rgba(76, 175, 80, 0.22)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.8rem',
                textShadow: '0 2px 4px rgba(0,0,0,0.13)',
                filter: 'brightness(1.08) drop-shadow(0 2px 8px #66bb6a88)',
                borderTop: '2.5px solid #388e3c',
                borderBottom: '2.5px solid #388e3c',
                borderLeft: '2.5px solid #388e3c',
                borderRight: '2.5px solid #388e3c',
                transition: 'background 0.2s',
              }}
            >
              <span style={{ fontSize: '1.3rem' }}>🎙️</span>
              {recording ? 'Recording...' : 'Start Talking'}
            </button>
            <button 
              onClick={handleStop} 
              disabled={!recording}
              style={{
                padding: '1.2rem 2.1rem',
                borderRadius: '22px',
                border: 'none',
                background: !recording ? 'rgba(255, 255, 255, 0.2)' : 'linear-gradient(135deg, #f44336 0%, #ef5350 100%)',
                color: !recording ? '#9e9e9e' : '#ffffff',
                fontSize: '1.13rem',
                fontWeight: '700',
                cursor: !recording ? 'not-allowed' : 'pointer',
                boxShadow: !recording ? 'none' : '0 16px 36px rgba(244, 67, 54, 0.22)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.8rem',
                textShadow: '0 2px 4px rgba(0,0,0,0.13)',
                filter: 'brightness(1.08) drop-shadow(0 2px 8px #ef535088)',
                borderTop: '2.5px solid #b71c1c',
                borderBottom: '2.5px solid #b71c1c',
                borderLeft: '2.5px solid #b71c1c',
                borderRight: '2.5px solid #b71c1c',
                transition: 'background 0.2s',
              }}
            >
              <span style={{ fontSize: '1.3rem' }}>⏹️</span>
              Stop
            </button>
            <button 
              onClick={handleSendTranscript} 
              disabled={!pendingTranscript}
              style={{
                padding: '1.2rem 2.1rem',
                borderRadius: '22px',
                border: 'none',
                background: (!pendingTranscript) ? 'rgba(255, 255, 255, 0.2)' : 'linear-gradient(135deg, #2196f3 0%, #42a5f5 100%)',
                color: (!pendingTranscript) ? '#9e9e9e' : '#ffffff',
                fontSize: '1.13rem',
                fontWeight: '700',
                cursor: (!pendingTranscript) ? 'not-allowed' : 'pointer',
                boxShadow: (!pendingTranscript) ? 'none' : '0 16px 36px rgba(33, 150, 243, 0.22)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.8rem',
                textShadow: '0 2px 4px rgba(0,0,0,0.13)',
                filter: (!pendingTranscript) ? 'none' : 'brightness(1.08) drop-shadow(0 2px 8px #42a5f588)',
                borderTop: (!pendingTranscript) ? 'none' : '2.5px solid #1976d2',
                borderBottom: (!pendingTranscript) ? 'none' : '2.5px solid #1976d2',
                borderLeft: (!pendingTranscript) ? 'none' : '2.5px solid #1976d2',
                borderRight: (!pendingTranscript) ? 'none' : '2.5px solid #1976d2',
                transition: 'background 0.2s',
              }}
            >
              <span style={{ fontSize: '1.3rem' }}>💬</span>
              Send
            </button>
            {/* Play Response button for latest AI message */}
            <button
              onClick={handlePlayTTS}
              disabled={!messages.some(m => m.role === 'solace')}
              style={{
                padding: '1.2rem 2.1rem',
                borderRadius: '22px',
                border: 'none',
                background: (!messages.some(m => m.role === 'solace')) ? 'rgba(255, 255, 255, 0.2)' : 'linear-gradient(135deg, #7e57c2 0%, #9575cd 100%)',
                color: (!messages.some(m => m.role === 'solace')) ? '#9e9e9e' : '#ffffff',
                fontSize: '1.13rem',
                fontWeight: '700',
                cursor: (!messages.some(m => m.role === 'solace')) ? 'not-allowed' : 'pointer',
                boxShadow: (!messages.some(m => m.role === 'solace')) ? 'none' : '0 16px 36px rgba(126, 87, 194, 0.22)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.8rem',
                textShadow: '0 2px 4px rgba(0,0,0,0.13)',
                filter: (!messages.some(m => m.role === 'solace')) ? 'none' : 'brightness(1.08) drop-shadow(0 2px 8px #9575cd88)',
                borderTop: (!messages.some(m => m.role === 'solace')) ? 'none' : '2.5px solid #5e35b1',
                borderBottom: (!messages.some(m => m.role === 'solace')) ? 'none' : '2.5px solid #5e35b1',
                borderLeft: (!messages.some(m => m.role === 'solace')) ? 'none' : '2.5px solid #5e35b1',
                borderRight: (!messages.some(m => m.role === 'solace')) ? 'none' : '2.5px solid #5e35b1',
                transition: 'background 0.2s',
              }}
            >
              <span style={{ fontSize: '1.3rem' }}>🔊</span>
              Play Response
            </button>
            {/* Audio element for playback */}
            {ttsAudioUrl && (
              <audio ref={audioRef} src={ttsAudioUrl} autoPlay style={{ display: 'none' }} />
            )}
          </div>
          {/* Status/Error */}
          <div style={{
            marginTop: '1.2rem',
            textAlign: 'center',
          }}>
            <span style={{
              fontSize: '1rem',
              color: error ? '#d32f2f' : '#1b5e20',
              fontWeight: '600',
              textShadow: '0 2px 4px rgba(0,0,0,0.08)'
            }}>
              {error ? `Error: ${error}` : `Status: ${status}`}
            </span>
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
          0% { text-shadow: 0 4px 8px rgba(0,0,0,0.13), 0 0 20px rgba(76,175,80,0.13); }
          100% { text-shadow: 0 4px 8px rgba(0,0,0,0.13), 0 0 30px rgba(76,175,80,0.18); }
        }
      `}</style>
    </div>
  );
};

export default App;

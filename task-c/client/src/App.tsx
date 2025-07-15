import React, { useState, useRef, useEffect } from 'react';
// Remove VAD import
// import { recordAndDetectVoice } from './sdk';

// Move these utility functions to top-level (outside handleStop)
function floatTo16BitPCM(float32Array: Float32Array): Int16Array {
  const pcm = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm;
}
function encodeWAV(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    view.setInt16(offset, samples[i], true);
  }
  return buffer;
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
  // Remove VAD-related state
  // const [speechDetected, setSpeechDetected] = useState(false);
  // const framesRef = useRef<ArrayBuffer[]>([]);
  // const vadIteratorRef = useRef<AsyncIterableIterator<any> | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const [messages, setMessages] = useState<{role: 'user'|'solace', text: string}[]>([]);
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Add state for selected voice
  const [selectedVoice, setSelectedVoice] = useState<'Aria' | 'Matthew'>('Aria');
  // Add state for conversation history
  const [exchanges, setExchanges] = useState<ChatExchange[]>([]);
  // Add audio objects for sent/received sounds
  const sentSound = new Audio(process.env.PUBLIC_URL + '/sent.mp3');
  sentSound.volume = 0.7;
  const receivedSound = new Audio(process.env.PUBLIC_URL + '/received.mp3');
  receivedSound.volume = 0.7;
  const recordingRef = useRef(false);
  const [showAbout, setShowAbout] = useState(false);

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

  // Utility to convert VAD frames to WAV
  function framesToWav(frames: ArrayBuffer[], sampleRate: number): Blob {
    // Concatenate all PCM frames
    let totalLen = 0;
    for (const buf of frames) totalLen += buf.byteLength;
    const pcm = new Int16Array(totalLen / 2);
    let offset = 0;
    for (const buf of frames) {
      pcm.set(new Int16Array(buf), offset);
      offset += buf.byteLength / 2;
    }
    const wavBuffer = encodeWAV(pcm, sampleRate);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  // Start recording (capture ALL audio between Start and Stop)
  const handleStart = async () => {
    setTranscript('');
    setStatus('Listening...');
    setError(null);
    setChatResponse('');
    setPendingTranscript(null);
    audioBufferRef.current = [];
    setRecording(true);
    recordingRef.current = true;
    try {
      console.log('[AUDIO] Recording started');
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      mediaStreamRef.current = stream;
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;
      processor.onaudioprocess = (event) => {
        if (!recordingRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        // Copy input to a new Float32Array and store
        audioBufferRef.current.push(new Float32Array(input));
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      console.error('[AUDIO] Error starting recording:', err);
      setError('Microphone error: ' + (err instanceof Error ? err.message : String(err)));
      setRecording(false);
      recordingRef.current = false;
      setStatus('Error');
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    }
  };

  // Stop recording and send to ASR
  const handleStop = async () => {
    setRecording(false);
    recordingRef.current = false;
    setStatus('Transcribing...');
    try {
      // Clean up audio nodes
      if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current = null;
      }
      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
        sourceNodeRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      // Concatenate all Float32Array buffers
      const allSamples = audioBufferRef.current.length > 0
        ? new Float32Array(audioBufferRef.current.reduce((acc, cur) => acc + cur.length, 0))
        : new Float32Array(0);
      let offset = 0;
      for (const buf of audioBufferRef.current) {
        allSamples.set(buf, offset);
        offset += buf.length;
      }
      // Logging: buffer info
      console.log('[AUDIO] Recording stopped');
      console.log('[AUDIO] Number of audio buffers:', audioBufferRef.current.length);
      console.log('[AUDIO] Total samples:', allSamples.length);
      console.log('[AUDIO] Duration (s):', (allSamples.length / 16000).toFixed(3));
      if (allSamples.length > 0) {
        console.log('[AUDIO] First 10 samples:', Array.from(allSamples.slice(0, 10)));
        console.log('[AUDIO] Last 10 samples:', Array.from(allSamples.slice(-10)));
      }
      // Convert to WAV
      const pcm = floatTo16BitPCM(allSamples);
      const wavBuffer = encodeWAV(pcm, 16000);
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      console.log('[AUDIO] WAV blob size:', wavBlob.size, 'type:', wavBlob.type);
      // Send to Whisper as before
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
      if (!apiKey) {
        setError('No OpenAI API key provided. Please set your API key.');
        setStatus('Error');
        return;
      }
      console.log('[ASR] Sending request to:', ASR_API_URL);
      const resp = await fetch(ASR_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: formData
      });
      if (!resp.ok) {
        const data = await resp.json();
        console.error('[ASR] Error response:', data);
        setError('ASR failed: ' + (data?.error?.message || resp.statusText));
        setStatus('Error');
        return;
      }
      const data = await resp.json();
      console.log('[ASR] Success response:', data);
      setTranscript(data.text || '(No transcript)');
      setStatus('Transcript ready');
    } catch (err) {
      console.error('[ASR] Exception:', err);
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
      receivedSound.currentTime = 0;
      receivedSound.play();
      setMessages((msgs) => [...msgs, { role: 'solace', text: chatResponse }]);
    }
  }, [chatResponse]);

  // Update handleSendTranscript to add user message, clear preview, and trigger AI
  const handleSendTranscript = () => {
    if (pendingTranscript && pendingTranscript.trim()) {
      sentSound.currentTime = 0;
      sentSound.play();
      setMessages((msgs) => [...msgs, { role: 'user', text: pendingTranscript }]);
      setTranscript(pendingTranscript);
      setPendingTranscript(null);
      handleChat(pendingTranscript); // Pass the transcript to the AI
    }
  };

  // Play TTS for latest AI message
  const handlePlayTTS = async () => {
    if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) {
      // If audio is playing, stop and reset, do not play again
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      return;
    }
    const lastSolaceMsg = messages.filter(m => m.role === 'solace').slice(-1)[0];
    if (!lastSolaceMsg) return;
    setTtsAudioUrl(null);
    const voiceId = selectedVoice; // Use Aria or Matthew
    const url = await synthesizeSpeech(lastSolaceMsg.text, voiceId);
    if (url) {
      setTtsAudioUrl(url);
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.playbackRate = 1.3; // Set TTS speed to 1.3x
          audioRef.current.play();
        }
      }, 100);
    }
  };

  // Add click outside handler for dropdown
  useEffect(() => {
    if (!showAbout) return;
    function handleClick(e: MouseEvent) {
      const about = document.getElementById('solace-about-dropdown');
      if (about && !about.contains(e.target as Node)) {
        setShowAbout(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showAbout]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 25%, #a5d6a7 50%, #81c784 75%, #66bb6a 100%)',
      fontFamily: '"Fredoka One", "Comic Sans MS", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* About Dropdown Button (top right) */}
      <div style={{ position: 'absolute', top: 24, right: 32, zIndex: 20 }}>
        <button
          aria-label="Learn more about Solace"
          onClick={() => setShowAbout(v => !v)}
          style={{
            background: 'rgba(255,255,255,0.85)',
            border: '2.5px solid #2196f3',
            borderRadius: '50%',
            width: 44,
            height: 44,
            fontSize: '1.7rem',
            cursor: 'pointer',
            boxShadow: '0 2px 12px rgba(33,150,243,0.13)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.18s',
            outline: showAbout ? '2.5px solid #1976d2' : 'none',
          }}
        >
          <span role="img" aria-label="Learn more">❓</span>
        </button>
        {showAbout && (
          <div
            id="solace-about-dropdown"
            style={{
              position: 'absolute',
              top: 54,
              right: 0,
              minWidth: 320,
              maxWidth: 380,
              background: 'rgba(255,255,255,0.98)',
              border: '2.5px solid #2196f3',
              borderRadius: 16,
              boxShadow: '0 8px 32px rgba(33,150,243,0.13)',
              padding: '1.3rem 1.5rem',
              zIndex: 100,
              fontSize: '1.08rem',
              color: '#1b5e20',
              fontWeight: 500,
              lineHeight: 1.6,
              textAlign: 'left',
              marginTop: 8,
              animation: 'fadeIn 0.18s',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '1.18rem', marginBottom: 8, color: '#1976d2', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span role="img" aria-label="Learn more">❓</span> Learn more about me!
            </div>
            <div style={{ marginBottom: 10 }}>
              I'm available 24/7 to chat, listen, and support you—whether you want to talk, need advice, or just want a friendly presence. Everything you share is private and stays on your device unless you choose to send it.
            </div>
            <div style={{ marginBottom: 10 }}>
              <b>How does it work?</b><br/>
              Click 'Start Talking' to record, say what's on your mind, then review and send. Hit 'Play Response' to hear my reply out loud!
            </div>
            <div style={{ marginBottom: 10 }}>
              <b>What can I help with?</b><br/>
              - Want to vent about something? I'm here.<br/>
              - Need advice or a listening ear? I'll do my best.<br/>
              - Just wanna yap? I'm here too.<br/>
              <br/>
              <i>I'm not a replacement for professional help, but I'm always here to support you.</i>
            </div>
            <div style={{ fontSize: '0.98rem', color: '#388e3c', marginTop: 8 }}>
              <b>Tip:</b> You can start a conversation any time. I'm always ready to listen!
            </div>
          </div>
        )}
      </div>
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
        <div style={{ position: 'absolute', top: '10%', left: '5%', fontSize: '67px', color: 'rgba(76, 175, 80, 0.4)', animation: 'float 8s ease-in-out infinite', transform: 'rotate(15deg)', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}>🍃</div>
        <div style={{ position: 'absolute', top: '20%', right: '10%', fontSize: '56px', color: 'rgba(76, 175, 80, 0.5)', animation: 'float 10s ease-in-out infinite reverse', transform: 'rotate(-20deg)', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}>🌿</div>
        <div style={{ position: 'absolute', bottom: '15%', left: '15%', fontSize: '50px', color: 'rgba(76, 175, 80, 0.4)', animation: 'float 9s ease-in-out infinite', transform: 'rotate(45deg)', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}>🍃</div>
        <div style={{ position: 'absolute', bottom: '25%', right: '5%', fontSize: '62px', color: 'rgba(76, 175, 80, 0.5)', animation: 'float 11s ease-in-out infinite reverse', transform: 'rotate(-30deg)', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}>🌿</div>
        <div style={{ position: 'absolute', top: '50%', left: '50%', fontSize: '73px', color: 'rgba(76, 175, 80, 0.3)', animation: 'float 12s ease-in-out infinite', transform: 'translate(-50%, -50%) rotate(60deg)', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}>🍃</div>
      </div>

      {/* Mic dropdown at top left */}
      <div style={{
        position: 'absolute',
        top: 24,
        left: 24,
        zIndex: 2,
        minWidth: 320, // was 340
        maxWidth: 400, // was 420
        background: 'rgba(255,255,255,0.22)',
        borderRadius: '16px',
        padding: '0.6rem 1rem 0.6rem 1rem', // was 0.8rem 1.2rem 0.8rem 1.2rem
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
      </div>
      {/* Friendly waving message below mic box */}
      <div style={{
        position: 'absolute',
        top: 220, // was 120
        left: 32,
        zIndex: 2,
        maxWidth: 320,
        background: 'rgba(255,255,255,0.18)',
        borderRadius: '14px',
        padding: '1.1rem 1.2rem',
        boxShadow: '0 4px 16px rgba(76,175,80,0.10)',
        border: '2px solid rgba(76, 175, 80, 0.13)',
        color: '#1b5e20',
        fontWeight: 500,
        fontSize: '1.08rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.7rem',
      }}>
        <span role="img" aria-label="wave" style={{ fontSize: '2.1rem' }}>👋</span>
        Hi! I'm Solace, your personal AI companion for emotional wellness and mental health. Feel free to send me a message whenever :)
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
        marginTop: '0.5rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '88vh',
        maxWidth: 900,
        width: '100%',
        boxSizing: 'border-box',
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.72)',
          borderRadius: '32px',
          boxShadow: '0 32px 64px rgba(0, 0, 0, 0.18), 0 2px 0 rgba(255, 255, 255, 0.18)',
          border: '3.5px solid #2e7d32',
          padding: 0, // remove vertical padding
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          backdropFilter: 'blur(18px)',
          boxSizing: 'border-box',
        }}>
          {/* Header - always at top */}
          <div style={{
            textAlign: 'center',
            margin: 0, // remove margin
            padding: '1rem 2.2rem 0 2.2rem', // move header close to top
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
            {messages.length === 0 && (
              <div style={{ color: '#888', textAlign: 'center', marginTop: '2rem', fontSize: '1.1rem' }}>
                Start a conversation with Solace!
              </div>
            )}
          </div>
          {/* Chat Log - scrollable */}
          <div style={{
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.1rem',
            margin: 0, // remove margin
            padding: '0 1rem', // reduced horizontal padding
            width: '100%',
            maxWidth: '100%',
            flex: 1,
            boxSizing: 'border-box',
          }}>
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
                  fontSize: '1.01rem', // was 1.13rem
                  boxShadow: msg.role === 'user'
                    ? '0 2px 16px 0 rgba(33,150,243,0.13), 0 2px 0 rgba(255,255,255,0.18)'
                    : '0 2px 16px 0 rgba(180,180,180,0.13), 0 2px 0 rgba(255,255,255,0.18)',
                  position: 'relative',
                  backdropFilter: 'blur(10px)',
                  textAlign: msg.role === 'user' ? 'right' : 'left',
                }}
              >
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
      {/* Tip box at bottom left */}
      <div style={{
        position: 'absolute',
        left: 32,
        bottom: 32,
        zIndex: 2,
        maxWidth: 320,
        background: 'rgba(255,255,255,0.13)',
        borderRadius: '12px',
        padding: '0.8rem 1.1rem',
        boxShadow: '0 2px 8px rgba(76,175,80,0.08)',
        border: '1.5px solid rgba(76, 175, 80, 0.10)',
        color: '#256029',
        fontWeight: 400,
        fontSize: '0.98rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        opacity: 0.92,
      }}>
        <span role="img" aria-label="lightbulb" style={{ fontSize: '1.2rem' }}>💡</span>
        Tip: Click the "?" on the top right to learn more about how to use your Solace!
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
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default App;

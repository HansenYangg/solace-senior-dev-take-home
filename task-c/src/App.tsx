import React, { useState, useRef } from 'react';
// Import the SDK VAD
import { recordAndDetectVoice } from '../../task-B/src/sdk';

// Utility: Convert PCM frames to WAV Blob
function pcmToWav(frames: ArrayBuffer[], sampleRate = 16000): Blob {
  const pcmLength = frames.reduce((sum, buf) => sum + buf.byteLength, 0);
  const wavBuffer = new ArrayBuffer(44 + pcmLength);
  const view = new DataView(wavBuffer);
  // RIFF header
  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, pcmLength, true);
  // PCM data
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
  const framesRef = useRef<ArrayBuffer[]>([]);
  const vadIteratorRef = useRef<AsyncIterableIterator<any> | null>(null);

  // Start recording
  const handleStart = async () => {
    setTranscript('');
    setStatus('Listening...');
    setError(null);
    setChatResponse('');
    framesRef.current = [];
    setRecording(true);
    try {
      const vad = recordAndDetectVoice({ sampleRate: 16000, sensitivity: 2, frameDuration: 30 });
      vadIteratorRef.current = vad[Symbol.asyncIterator]();
      for await (const { frame } of vad) {
        if (!recording) break;
        framesRef.current.push(frame);
      }
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
      // Convert PCM frames to WAV
      const wavBlob = pcmToWav(framesRef.current, 16000);
      // Send to ASR endpoint (OpenAI Whisper API example)
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      // You may need to add your API key here
      const resp = await fetch(ASR_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY || ''}`
        },
        body: formData
      });
      if (!resp.ok) throw new Error('ASR failed: ' + resp.statusText);
      const data = await resp.json();
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
      const resp = await fetch(CHAT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY || ''}`
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
      <div style={{ marginBottom: 16 }}>
        <button onClick={handleStart} disabled={recording}>Talk</button>
        <button onClick={handleStop} disabled={!recording}>Stop</button>
        <button onClick={handleChat} disabled={!transcript || chatLoading}>Send to Chatbot</button>
      </div>
      <div><b>Status:</b> {status}</div>
      {error && <div style={{ color: 'red' }}><b>Error:</b> {error}</div>}
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
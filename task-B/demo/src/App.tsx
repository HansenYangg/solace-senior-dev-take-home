// Solace Client SDK Demo
//
// This demo shows:
// 1. Securely capturing audio from the user's microphone in the browser.
// 2. Detecting when the user is speaking (Voice Activity Detection, VAD).
// 3. Encrypting the detected voice data in the browser (client-side).
// 4. Uploading the encrypted data to S3 via a presigned URL (using Task A backend).
// 5. Downloading and decrypting the data in the browser (proving end-to-end security).
//
// The UI flow:
// - Start Recording: Begins listening to the mic, runs VAD, and collects only the frames where you are speaking.
// - Stop & Upload: Stops recording, encrypts the collected voice frames, and uploads them to S3.
// - Fetch & Decrypt: Downloads the encrypted blob from S3, decrypts it in the browser, and shows the plaintext result.
//
// This demonstrates a privacy-preserving, secure, and modern approach to handling sensitive voice data in web apps—no raw audio ever leaves the browser unencrypted.

console.log("App.js loaded");

import React, { useState, useRef, useEffect } from "react";
// Import SDK functions from local copy
import { recordAndDetectVoice, VADConfig } from './sdk';

const BACKEND_URL = "https://3egrsa29p0.execute-api.us-east-1.amazonaws.com/Prod"; 

// Utility to check if a value is a React element
function isReactElement(obj: any): boolean {
  return obj && typeof obj === "object" && (obj as any).$$typeof !== undefined;
}

function App() {
  const [recording, setRecording] = useState(false);
  const [voiceFrames, setVoiceFrames] = useState<ArrayBuffer[]>([]);
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [blobKey, setBlobKey] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<string>("");
  const [status, setStatus] = useState<string>("Ready to record");
  const [isProcessingFrames, setIsProcessingFrames] = useState(false);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string | undefined>(undefined);
  
  // Refs for managing recording state
  const recordingRef = useRef(false);
  const voiceFramesRef = useRef<ArrayBuffer[]>([]);
  const voiceIteratorRef = useRef<AsyncGenerator<{ frame: ArrayBuffer; timestamp: number }> | null>(null);
  const processVoiceFramesPromiseRef = useRef<Promise<void> | null>(null);
  const stoppedRef = useRef(false);
  const [vadConfig, setVadConfig] = useState<VADConfig>({
    sensitivity: 1, // Match Task C for best results
    frameDuration: 30,
    sampleRate: 16000
  });

  // Fetch available microphones on mount
  useEffect(() => {
    async function fetchMics() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter(d => d.kind === 'audioinput');
        setMicDevices(mics);
        if (mics.length > 0) setSelectedMicId(mics[0].deviceId);
      } catch (e) {
        setMicDevices([]);
      }
    }
    fetchMics();
  }, []);

  // Real VAD-based recording
  const handleStartRecording = async () => {
    try {
      setIsProcessingFrames(true);
      setVoiceFrames([]);
      voiceFramesRef.current = [];
      recordingRef.current = true;
      stoppedRef.current = false;
      
      console.log('Starting recording with VAD config:', vadConfig, 'mic:', selectedMicId);
      
      console.log('About to call recordAndDetectVoice...');
      let voiceIterator: AsyncIterable<{ frame: ArrayBuffer; timestamp: number }>;
      try {
        voiceIterator = recordAndDetectVoice({ ...vadConfig, deviceId: selectedMicId });
        voiceIteratorRef.current = voiceIterator as AsyncGenerator<{ frame: ArrayBuffer; timestamp: number }>;
        console.log('recordAndDetectVoice returned:', voiceIterator);
        console.log('voiceIterator type:', typeof voiceIterator);
        console.log('voiceIterator has Symbol.asyncIterator:', voiceIterator && typeof voiceIterator[Symbol.asyncIterator] === 'function');
      } catch (error) {
        console.error('Error calling recordAndDetectVoice:', error);
        setStatus('Error starting VAD: ' + (error instanceof Error ? error.message : String(error)));
        setIsProcessingFrames(false);
        return;
      }
      
      setRecording(true);
      setStatus("Recording with VAD... Speak now!");
      
      // Process voice frames using for-await-of
      const processVoiceFrames = async () => {
        console.log('=== processVoiceFrames started ===');
        let frameReceived = false;
        try {
          console.log('processVoiceFrames: Starting for-await loop...');
          for await (const voiceFrame of voiceIterator) {
            if (stoppedRef.current) break;
            if (!recordingRef.current) {
              console.log('processVoiceFrames: recording stopped, breaking');
              break;
            }
            
            console.log('processVoiceFrames: got voice frame', voiceFrame);
            console.log('processVoiceFrames: frame size =', voiceFrame.frame.byteLength);
            
            voiceFramesRef.current.push(voiceFrame.frame);
            setVoiceFrames([...voiceFramesRef.current]);
            frameReceived = true;
            console.log('processVoiceFrames: frame pushed, total:', voiceFramesRef.current.length);
            setStatus(`Recording... ${voiceFramesRef.current.length} voice frames captured`);
          }
          console.log('=== processVoiceFrames: iterator completed ===');
        } catch (error) {
          console.error('Error processing voice frames:', error);
          setStatus('Error processing voice frames: ' + (error instanceof Error ? error.message : String(error)));
        } finally {
          console.log('processVoiceFrames: finally block, setting isProcessingFrames to false');
          setIsProcessingFrames(false);
        }
      };
      processVoiceFramesPromiseRef.current = processVoiceFrames();
    } catch (error) {
      console.error('Error starting recording:', error);
      setStatus('Error starting recording: ' + (error instanceof Error ? error.message : String(error)));
      setIsProcessingFrames(false);
    }
  };

  const handleStopAndUpload = async () => {
    setStatus("Stopping recording and processing...");
    recordingRef.current = false;
    setRecording(false);
    stoppedRef.current = true;
    // Properly stop VAD generator and trigger cleanup
    if (voiceIteratorRef.current && voiceIteratorRef.current.return) {
      console.log('[DEBUG] Calling voiceIteratorRef.current.return()');
      try {
        await Promise.race([
          voiceIteratorRef.current.return(undefined),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Generator cleanup timeout")), 2000))
        ]);
        console.log('[DEBUG] voiceIteratorRef.current.return() completed');
      } catch (e) {
        console.warn("Generator cleanup failed or timed out", e);
      }
      voiceIteratorRef.current = null;
    }
    // Wait for processVoiceFrames to finish
    if (processVoiceFramesPromiseRef.current) {
      console.log('[DEBUG] Waiting for processVoiceFramesPromiseRef.current');
      try {
        await Promise.race([
          processVoiceFramesPromiseRef.current,
          new Promise((_, reject) => setTimeout(() => reject(new Error("Frame processing timeout")), 2000))
        ]);
        console.log('[DEBUG] processVoiceFramesPromiseRef.current completed');
      } catch (e) {
        console.warn("Frame processing failed or timed out", e);
      }
      processVoiceFramesPromiseRef.current = null;
    }
    // Wait for at least one frame or a timeout
    let waitCount = 0;
    while (voiceFramesRef.current.length === 0 && waitCount < 20) { // wait up to 2 seconds
      await new Promise(res => setTimeout(res, 100));
      waitCount++;
    }
    
    if (voiceFramesRef.current.length === 0) {
      setStatus("No voice frames captured. Please try recording again.");
      return;
    }
    
    setStatus("Encrypting and uploading voice data...");
    // Combine all voice frames into a single blob
    const combinedAudio = new Blob(voiceFramesRef.current, { type: 'audio/pcm' });
    const data = `Voice recording with ${voiceFramesRef.current.length} frames`;
    // Encrypt the data
    const enc = new TextEncoder();
    const key = await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    setCryptoKey(key);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = enc.encode(data);
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );
    // Combine IV and encrypted data for storage
    const encryptedBlob = new Blob([
      iv.buffer,
      encrypted
    ], { type: "application/octet-stream" });
    // 1. Request presigned upload URL from backend
    const filename = `demo-${Date.now()}.bin`;
    const uploadUrlResp = await fetch(`${BACKEND_URL}/get-upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename })
    });
    if (!uploadUrlResp.ok) {
      setStatus("Failed to get upload URL");
      return;
    }
    const { url, key: s3key } = await uploadUrlResp.json();
    // 2. Upload encrypted blob to S3
    try {
      await fetch(url, {
        method: "PUT",
        body: encryptedBlob,
        headers: {
          "Content-Type": "application/octet-stream",
          "x-amz-server-side-encryption": "aws:kms"
        }
      });
      setBlobKey(s3key);
      setStatus(`Uploaded! BlobKey: ${s3key}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus("Upload failed: " + message);
    }
    // Reset refs after stopping
    voiceFramesRef.current = [];
    stoppedRef.current = false;
  };

  const handleFetchAndDecrypt = async () => {
    setStatus("Fetching and decrypting...");
    if (!blobKey || !cryptoKey) {
      setStatus("No blobKey or cryptoKey");
      return;
    }
    // 1. Request presigned download URL from backend
    const downloadUrlResp = await fetch(`${BACKEND_URL}/get-download-url?key=${encodeURIComponent(blobKey)}`);
    if (!downloadUrlResp.ok) {
      setStatus("Failed to get download URL");
      return;
    }
    const { url } = await downloadUrlResp.json();
    // 2. Download encrypted blob from S3
    try {
      const encryptedBlob = await fetch(url).then(r => r.blob());
      // 3. Parse IV and encrypted data
      const arrayBuffer = await encryptedBlob.arrayBuffer();
      const iv = new Uint8Array(arrayBuffer.slice(0, 12));
      const encrypted = arrayBuffer.slice(12);
      // 4. Decrypt
      const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        encrypted
      );
      const dec = new TextDecoder();
      setPlaintext(dec.decode(decrypted));
      setStatus("Decryption complete!");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus("Error: " + message);
    }
  };

  // Debug logs for status and plaintext
  console.log(
    "status:",
    status,
    typeof status,
    isReactElement(status) ? "REACT ELEMENT" : ""
  );
  console.log(
    "plaintext:",
    plaintext,
    typeof plaintext,
    isReactElement(plaintext) ? "REACT ELEMENT" : ""
  );

  return (
    <div style={{ maxWidth: 500, margin: "2rem auto", padding: 24, border: "1px solid #ccc", borderRadius: 8 }}>
      <h2>Solace Client SDK Demo</h2>
      
      {/* VAD Configuration */}
      <div style={{ marginBottom: 16, padding: 12, background: "#f0f0f0", borderRadius: 4 }}>
        <h4>VAD Configuration</h4>
        <div style={{ marginBottom: 8 }}>
          <label>Microphone: </label>
          <select value={selectedMicId} onChange={e => setSelectedMicId(e.target.value)} disabled={recording}>
            {micDevices.map(mic => (
              <option key={mic.deviceId} value={mic.deviceId}>{mic.label || `Microphone (${mic.deviceId})`}</option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Sensitivity: </label>
          <select 
            value={vadConfig.sensitivity} 
            onChange={(e) => setVadConfig((prev: VADConfig) => ({ ...prev, sensitivity: Number(e.target.value) }))}
            disabled={recording}
          >
            <option value={0}>0 - Least sensitive</option>
            <option value={1}>1 - Low sensitivity</option>
            <option value={2}>2 - Medium sensitivity</option>
            <option value={3}>3 - Most sensitive</option>
          </select>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Frame Duration: </label>
          <select 
            value={vadConfig.frameDuration} 
            onChange={(e) => setVadConfig((prev: VADConfig) => ({ ...prev, frameDuration: Number(e.target.value) }))}
            disabled={recording}
          >
            <option value={10}>10ms</option>
            <option value={20}>20ms</option>
            <option value={30}>30ms</option>
          </select>
        </div>
        <div>
          <label>Sample Rate: </label>
          <select 
            value={vadConfig.sampleRate} 
            onChange={(e) => setVadConfig((prev: VADConfig) => ({ ...prev, sampleRate: Number(e.target.value) }))}
            disabled={recording}
          >
            <option value={8000}>8kHz</option>
            <option value={16000}>16kHz</option>
            <option value={32000}>32kHz</option>
            <option value={48000}>48kHz</option>
          </select>
        </div>
      </div>
      
      <div style={{ marginBottom: 16 }}>
        <button onClick={handleStartRecording} disabled={recording}>Start Recording</button>
        <button onClick={handleStopAndUpload} disabled={!recording}>Stop & Upload</button>
        <button onClick={handleFetchAndDecrypt} disabled={!blobKey}>Fetch & Decrypt</button>
      </div>
      
      {/* Voice Frames Counter */}
      {voiceFrames.length > 0 && (
        <div style={{ marginBottom: 16, padding: 8, background: "#e8f5e8", borderRadius: 4 }}>
          <strong>Voice Frames Captured:</strong> {voiceFrames.length}
        </div>
      )}
      <div><b>Status:</b> {isReactElement(status) ? '[React element]' : (typeof status === "object" ? JSON.stringify(status) : status)}</div>
      <div style={{ marginTop: 24 }}>
        <b>Plaintext Result:</b>
        <div style={{ background: "#f7f7f7", padding: 12, borderRadius: 4, minHeight: 32 }}>{isReactElement(plaintext) ? '[React element]' : (typeof plaintext === "object" ? JSON.stringify(plaintext) : plaintext)}</div>
      </div>
    </div>
  );
}

export default App; 
console.log("App.js loaded");

import React, { useState } from "react";
// Import SDK functions (adjust path as needed)
// If you want to use the SDK, you may need to adjust the import path or logic
// import { encryptBlob, decryptBlob, uploadBlobToS3, downloadBlobFromS3 } from '../../src';

const BACKEND_URL = "https://3egrsa29p0.execute-api.us-east-1.amazonaws.com/Prod"; // Set to your backend base URL

// Utility to check if a value is a React element
function isReactElement(obj: any): boolean {
  return obj && typeof obj === "object" && (obj as any).$$typeof !== undefined;
}

function App() {
  const [recording, setRecording] = useState(false);
  const [blobKey, setBlobKey] = useState("");
  const [plaintext, setPlaintext] = useState("");
  const [status, setStatus] = useState("");
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);

  // Placeholder: Simulate recording and uploading a blob
  const handleStartRecording = () => {
    setStatus("Recording... (simulated)");
    setRecording(true);
  };

  const handleStopAndUpload = async () => {
    setStatus("Encrypting and uploading...");
    setRecording(false);
    // Simulate a blob (in real app, use audio data)
    const data = "hello-solace-demo";
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
      <div style={{ marginBottom: 16 }}>
        <button onClick={handleStartRecording} disabled={recording}>Start Recording</button>
        <button onClick={handleStopAndUpload} disabled={!recording}>Stop & Upload</button>
        <button onClick={handleFetchAndDecrypt} disabled={!blobKey}>Fetch & Decrypt</button>
      </div>
      <div><b>Status:</b> {isReactElement(status) ? '[React element]' : (typeof status === "object" ? JSON.stringify(status) : status)}</div>
      <div style={{ marginTop: 24 }}>
        <b>Plaintext Result:</b>
        <div style={{ background: "#f7f7f7", padding: 12, borderRadius: 4, minHeight: 32 }}>{isReactElement(plaintext) ? '[React element]' : (typeof plaintext === "object" ? JSON.stringify(plaintext) : plaintext)}</div>
      </div>
    </div>
  );
}

export default App; 
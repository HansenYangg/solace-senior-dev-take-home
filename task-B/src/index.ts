// Solace Client SDK - src/index.ts

// Helper functions for base64 encoding/decoding 
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
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

// Encryption APIs
export async function encryptBlob(data: string): Promise<{ iv: string; ciphertext: string; tag: string }> {
  const enc = new TextEncoder();
  const key = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = enc.encode(data);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  // AES-GCM ciphertext includes the tag at the end
  // We'll split it for API compatibility
  const tagLength = 16; // 128 bits
  const ciphertextBytes = new Uint8Array(encrypted);
  const tag = ciphertextBytes.slice(ciphertextBytes.length - tagLength);
  const ciphertext = ciphertextBytes.slice(0, ciphertextBytes.length - tagLength);
  return {
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(ciphertext.buffer),
    tag: arrayBufferToBase64(tag.buffer),
  };
}

export async function decryptBlob(
  { iv, ciphertext, tag }: { iv: string; ciphertext: string; tag: string },
  key: CryptoKey
): Promise<string> {
  const dec = new TextDecoder();
  const ivBuf = base64ToArrayBuffer(iv);
  const ciphertextBuf = base64ToArrayBuffer(ciphertext);
  const tagBuf = base64ToArrayBuffer(tag);
  // Concatenate ciphertext and tag
  const fullCipher = new Uint8Array(ciphertextBuf.byteLength + tagBuf.byteLength);
  fullCipher.set(new Uint8Array(ciphertextBuf), 0);
  fullCipher.set(new Uint8Array(tagBuf), ciphertextBuf.byteLength);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(ivBuf) },
    key,
    fullCipher
  );
  return dec.decode(decrypted);
}

// --- Voice Activity Detection (VAD) ---
export async function* recordAndDetectVoice(): AsyncIterable<{ frame: ArrayBuffer; timestamp: number }> {
  // TODO: Integrate webrtcvad.js or equivalent
  throw new Error('Not implemented');
}

// --- Upload/Download Helpers ---
export async function uploadBlob(blob: Blob, apiUrl: string, token?: string): Promise<string> {
  // POST the blob to the Task A endpoint, return blobKey
  const formData = new FormData();
  formData.append('file', blob);
  // Optionally add token for auth
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    body: formData,
    headers,
  });
  if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);
  const data = await response.json();
  if (!data.blobKey) throw new Error('No blobKey returned from server');
  return data.blobKey;
}

export async function downloadAndDecrypt(blobKey: string, apiUrl: string, key: CryptoKey): Promise<string> {
  // Download from Task A endpoint and decrypt
  const response = await fetch(`${apiUrl}?blobKey=${encodeURIComponent(blobKey)}`);
  if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
  const data = await response.json();
  if (!data.plaintext) throw new Error('No plaintext returned from server');
  // The plaintext is base64-encoded
  const plaintextBuf = base64ToArrayBuffer(data.plaintext);
  const dec = new TextDecoder();
  return dec.decode(plaintextBuf);
} 

// --- S3 Direct Upload/Download via Presigned URLs ---
/**
 * Uploads a Blob directly to S3 using a presigned URL.
 * @param blob The Blob to upload
 * @param presignedUrl The presigned S3 URL for PUT
 * @returns The S3 object key (if known), or void
 */
export async function uploadBlobToS3(blob: Blob, presignedUrl: string): Promise<void> {
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    body: blob,
    // No custom headers unless required by the presigned URL
  });
  if (!response.ok) throw new Error(`S3 upload failed: ${response.statusText}`);
}

/**
 * Downloads a Blob directly from S3 using a presigned URL.
 * @param presignedUrl The presigned S3 URL for GET
 * @returns The downloaded Blob
 */
export async function downloadBlobFromS3(presignedUrl: string): Promise<Blob> {
  const response = await fetch(presignedUrl);
  if (!response.ok) throw new Error(`S3 download failed: ${response.statusText}`);
  return await response.blob();
}

/**
 * Expected backend endpoints (Task A) for presigned URL flow:
 *   POST /get-upload-url { filename } => { url, key }
 *   GET  /get-download-url?key=... => { url }
 *
 * The SDK should:
 *   1. Request a presigned upload URL from the backend
 *   2. PUT the file to S3 using uploadBlobToS3
 *   3. Store the returned S3 key
 *   4. Request a presigned download URL from the backend using the key
 *   5. GET the file from S3 using downloadBlobFromS3
 */ 
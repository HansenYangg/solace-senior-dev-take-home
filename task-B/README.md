# Task B: Cross-Platform Client SDK (@solace/client-sdk)

## Overview
A secure client SDK for blob encryption (AES-GCM 256), voice activity detection (VAD) powered by Ricky's Silero VAD (`@ricky0123/vad-web`), and integration with the Task A enclave-style decryption service.

---

## Features
- **encryptBlob(data: string): Promise<{ iv, ciphertext, tag }>`**
- **decryptBlob({ iv, ciphertext, tag }, key): Promise<string>**
- **recordAndDetectVoice(): AsyncIterable<{ frame: ArrayBuffer; timestamp: number }>**
- **uploadBlob(blob, apiUrl, token): Promise<string>**
- **downloadAndDecrypt(blobKey, apiUrl, key): Promise<string>**
- **uploadBlobToS3(blob, presignedUrl): Promise<void>**
- **downloadBlobFromS3(presignedUrl): Promise<Blob>**
- **detectVoiceActivity(buffer: Float32Array, sensitivity: number): boolean**
- Web Crypto API (AES-GCM 256)
- VAD via energy-based detection (browser, no native dependencies)
- React web demo app

---

## Installation

```sh
npm install @solace/client-sdk
# or clone this repo and run:
npm install
```

> **Note for Task C:**
> Due to Create React App limitations, you must copy the built SDK (`task-B/dist/index.js`) into your client app's `src/sdk/` directory and import from there:
> ```js
> import { encryptBlob, decryptBlob, recordAndDetectVoice } from './sdk/index';
> ```
> Do not import as an npm package in Task C.

---

## API Usage

### **encryptBlob**
```ts
import { encryptBlob } from '@solace/client-sdk';
const { iv, ciphertext, tag } = await encryptBlob('my secret data');
```

### **decryptBlob**
```ts
import { decryptBlob } from '@solace/client-sdk';
const plaintext = await decryptBlob({ iv, ciphertext, tag }, key);
```

### **recordAndDetectVoice**
```ts
import { recordAndDetectVoice, VADConfig } from '@solace/client-sdk';

// Configure VAD parameters
const config: VADConfig = {
  sensitivity: 2,        // 0-3 (0=least sensitive, 3=most sensitive)
  frameDuration: 30,     // 10, 20, or 30 ms
  sampleRate: 16000      // 8000, 16000, 32000, or 48000 Hz
};

// Start recording with VAD
for await (const { frame, timestamp } of recordAndDetectVoice(config)) {
  // handle speech frames (ArrayBuffer in 16-bit PCM format)
  console.log(`Voice detected at ${timestamp}ms`);
}
```

### **uploadBlob / downloadAndDecrypt**
```ts
import { uploadBlob, downloadAndDecrypt } from '@solace/client-sdk';
const blobKey = await uploadBlob(blob, apiUrl, token);
const plaintext = await downloadAndDecrypt(blobKey, apiUrl, key);
```

### **uploadBlobToS3**
```ts
import { uploadBlobToS3 } from '@solace/client-sdk';
await uploadBlobToS3(blob, presignedUrl); // PUTs blob to S3
```

### **downloadBlobFromS3**
```ts
import { downloadBlobFromS3 } from '@solace/client-sdk';
const blob = await downloadBlobFromS3(presignedUrl); // GETs blob from S3
```

### **detectVoiceActivity**
```ts
import { detectVoiceActivity } from '@solace/client-sdk';
const isVoice = detectVoiceActivity(float32PcmBuffer, sensitivity); // boolean
```

---

## Node.js vs Browser Support
- **Encryption/decryption**: Works in modern browsers (Web Crypto API). Node.js support requires `crypto.webcrypto` (Node 19+ or polyfill).
- **VAD/Audio**: Only works in browsers (uses Web Audio API, getUserMedia).
- **S3 helpers**: Work in both browser and Node.js (with `fetch` polyfill in Node).

---

## VAD Implementation Note
> **Note:** The VAD implementation in this SDK is now powered by Ricky's Silero VAD (`@ricky0123/vad-web`), a neural network-based model for accurate speech/silence detection in the browser. The previous energy-based (RMS) approach has been fully replaced.

---

## Demo App

A minimal React web demo is provided in `task-B/demo/`:
- **Start Recording**
- **Stop & Upload**
- **Fetch & Decrypt**
- Displays plaintext result

### **Run the Demo**
```sh
cd task-B/demo
npm install
npm start
```

---

## Testing
- Unit tests for encryption/decryption, VAD, and S3 helpers (Jest)
- To run all tests:

```sh
cd task-B
npm install
npm run test
```

---

## Local Development
- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm run test`

---

## Contributing & Development
- PRs and issues welcome!
- Please add/expand tests for new features.
- For local development, see scripts above.
- For questions, open an issue or contact the author.

---

## Deliverables Checklist
- [x] SDK package structure
- [x] Encryption/decryption APIs (AES-GCM 256)
- [x] VAD implementation with configurable sensitivity
- [x] Upload/download helpers for S3 presigned URLs
- [x] React demo app with real VAD integration
- [x] Unit test setup and encryption tests
- [x] README with usage and demo instructions
- [x] VAD configuration options (sensitivity, frame duration, sample rate)
- [x] Real-time voice activity detection
- [x] Audio processing and PCM conversion
- [x] S3 upload/download helpers with tests
- [x] API documentation for all public functions
- [x] Node.js/browser support notes 

## Architecture Flow

This SDK is used in two main flows:

### 1. Secure Blob Flow (Task A/B)
```
User Data
  ↓
Task B SDK (Encrypt)
  ↓
S3 (Encrypted Blob)
  ↓
Task A Lambda (Decrypt)
  ↓
User (Decrypted Data)
```
*This demonstrates secure enclave-style decryption using AWS Lambda and KMS.*

### 2. Task C: VAD & Optional Memory Layer
```
User Voice Input
  ↓
Task B SDK (VAD, optional memory encryption)
  ↓
ASR (OpenAI Whisper)
  ↓
Chatbot (OpenAI GPT)
  ↓
TTS (Polly)
  ↓
Voice Output
```
*In Task C, the SDK is used for VAD and for encrypting the optional memory layer. The main chat flow does not use S3 or Lambda.* 
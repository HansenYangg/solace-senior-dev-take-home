# Task B: Cross-Platform Client SDK (@solace/client-sdk)

## Overview
A secure client SDK for blob encryption (AES-GCM 256), voice activity detection (VAD), and integration with the Task A enclave-style decryption service.

---

## Features
- **encryptBlob(data: string): Promise<{ iv, ciphertext, tag }>`**
- **decryptBlob({ iv, ciphertext, tag }, key): Promise<string>**
- **recordAndDetectVoice(): AsyncIterable<{ frame: ArrayBuffer; timestamp: number }>**
- **uploadBlob(blob, apiUrl, token): Promise<string>**
- **downloadAndDecrypt(blobKey, apiUrl, key): Promise<string>**
- Web Crypto API (AES-GCM 256)
- VAD via webrtcvad.js
- React web demo app

---

## Installation

```sh
npm install @solace/client-sdk
# or clone this repo and run:
npm install
```

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
- Unit tests for encryption/decryption (Jest)
- Simulate VAD on prerecorded audio

```sh
npm test
```

---

## Local Development
- Build: `npm run build`
- Lint: `npm run lint`

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
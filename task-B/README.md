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
import { recordAndDetectVoice } from '@solace/client-sdk';
for await (const { frame, timestamp } of recordAndDetectVoice()) {
  // handle speech frames
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
- [x] Encryption/decryption APIs
- [x] VAD API stub
- [x] Upload/download helpers stub
- [x] React demo app scaffold
- [x] Unit test setup
- [x] README with usage and demo instructions 
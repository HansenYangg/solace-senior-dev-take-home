# Solace Senior Developer Take-Home

A secure voice processing system with enclave-style decryption, cross-platform client SDK, and end-to-end voice companion demo.

## Project Structure

- **task-A/**: Enclave-Style Decryption Service (AWS Lambda + KMS)
- **task-B/**: Cross-Platform Client SDK (@solace/client-sdk, powered by Silero VAD)
- **task-C/**: Solace Lite End-to-End Demo (Voice → Voice Companion, using Silero VAD)

## Prerequisites

- Node.js (>=16.x)
- Python (>=3.9)
- AWS CLI
- Docker
- Git
- AWS SAM CLI

## Quick Start

1. **Task A**: Deploy the decryption service
   ```bash
   cd task-A
   # Follow setup instructions in task-A/README.md
   ```

2. **Task B**: Install and test the client SDK
   ```bash
   cd task-B
   # Follow setup instructions in task-B/README.md
   ```

3. **Task C**: Run the end-to-end demo
   ```bash
   cd task-C
   # Follow setup instructions in task-C/README.md
   ```

## Local TTS (Polly Proxy) Setup

To enable Text-to-Speech (TTS) in the Task C frontend, you must run a local AWS Polly proxy server:

1. In the project root, create a `.env` file with your AWS credentials:
   ```
   AWS_ACCESS_KEY_ID=your_access_key_id
   AWS_SECRET_ACCESS_KEY=your_secret_access_key
   AWS_REGION=us-east-1
   ```
2. Install dependencies:
   ```sh
   npm install express aws-sdk cors dotenv
   ```
3. Start the proxy server:
   ```sh
   node polly-proxy.js
   ```
   The proxy will listen on `http://localhost:5000/tts`.

4. The Task C React app will use this proxy for TTS. **The proxy must be running for TTS to work.**

## SDK Import Note (Task C)

> **Note:** In Task C, due to Create React App limitations, the SDK is imported via a local file copy in `src/sdk/index.js` (copied from `task-B/dist/index.js`), not as an npm package. See Task C's README for details.

## Submission Checklist

- [ ] Task A: Lambda decryption service deployed and tested
- [ ] Task B: Client SDK published and demo working
- [ ] Task C: End-to-end voice companion demo running
- [ ] All README files completed with setup instructions
- [ ] Security best practices implemented
- [ ] Tests passing across all components
- [ ] .env.example files provided (no secrets included)

## Architecture Overview

### 1. Task C: End-to-End Chat Demo
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
*This is the main flow for the voice-to-voice companion demo.*

### 2. Task A/B: Secure Blob Flow
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
*This flow demonstrates secure enclave-style decryption using AWS Lambda and KMS.*

### 3. Task C: Optional Encrypted Memory Layer
```
Transcript/Chat History
  ↓
Task B SDK (Encrypt)
  ↓
localStorage (Encrypted)
  ↓
Task B SDK (Decrypt)
  ↓
User (Decrypted History)
```
*This optional feature securely stores the last 3 transcripts in the browser.*

## Security Features

- AES-GCM 256 encryption for data in transit
- AWS KMS for secure key management
- Least-privilege IAM policies
- Encryption at rest on S3
- TEE-style isolation using Lambda + KMS
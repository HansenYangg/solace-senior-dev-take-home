# Solace Senior Developer Take-Home

A secure voice processing system with enclave-style decryption, cross-platform client SDK, and end-to-end voice companion demo.

## Project Structure

- **task-A/**: Enclave-Style Decryption Service (AWS Lambda + KMS)
- **task-B/**: Cross-Platform Client SDK (@solace/client-sdk, powered by Silero VAD)
- **task-C/**: Solace Lite End-to-End Demo (Voice → Voice Companion, using Silero VAD)

## Quick Start: Task C (End-to-End Demo)

1. **Clone the repo:**
   ```sh
   git clone <REPO_URL>
   cd solace-senior-dev-take-home
   ```
2. **Install dependencies:**
   ```sh
   cd task-c/client
   npm install
   ```
3. **Add your environment variables:**
   - Make a `.env` in task-c/client and fill in your variables (only the task-c specific variables, aka REACT_APP_OPENAI_API_KEY, REACT_APP_TTS_REGION, and REACT_APP_TTS_VOICE_ID).
4. **(Optional) Enable Text-to-Speech (TTS):**
   - In the project root, run:
     ```sh
     npm install express aws-sdk cors dotenv
     node polly-proxy.js
     ```
   - This starts a local AWS Polly proxy for TTS at `http://localhost:5000/tts`. Again, make sure you have a .env at the root with AWS_ACCESS_KEY_ID=... , AWS_SECRET_ACCESS_KEY=... , and AWS_REGION=... in the root for TTS to work.
5. **Run the app:**
   ```sh
   npm start
   ```
   - Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Note:** The SDK required for Task C is already included in `task-c/client/src/sdk/index.js`. You do NOT need to build or copy the SDK unless you want to update it. See Task C's README for details.

## For Task A and Task B
- See the respective `README.md` files in each directory for setup and usage instructions.

## Architecture Overview


### 1. Task A/B: Secure Blob Flow
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

### 2. Task C: Solace Lite End-to-End Demo
```
User Voice Input
  ↓
Task B SDK (VAD + Voice Capture)
  ↓
ASR (OpenAI Whisper)
  ↓
Chatbot (OpenAI GPT-3.5/4)
  ↓
TTS (AWS Polly)
  ↓
Voice Output
```
*This is a complete voice→voice companion demo with optional encrypted memory layer storing the last 3 transcripts in localStorage.*

## Security Features

- AES-GCM 256 encryption for data in transit
- AWS KMS for secure key management
- Least-privilege IAM policies
- Encryption at rest on S3
- TEE-style isolation using Lambda + KMS

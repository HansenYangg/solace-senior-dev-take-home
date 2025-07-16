# Task C: Solace Lite End-to-End Demo

---

## 🚨 Critical: Setting Up the SDK for Voice Features (Step-by-Step)

> **IMPORTANT:** The voice recording and encryption features in this app **will NOT work** unless you set up the SDK correctly. Due to Create React App (CRA) limitations, you must manually copy the SDK file from Task B and import it locally. Follow these steps:

### 1. Build the SDK in Task B

Open a terminal in the project root and run:
```sh
cd ../../task-B
npm install
npm run build
```
This will generate the SDK file at `task-B/dist/index.js`.

### 2. Copy the SDK File to Task C

Copy the built SDK file into your client app:
```sh
cp ../../task-B/dist/index.js ./src/sdk/index.js
```
If the `src/sdk/` directory does not exist, create it first:
```sh
mkdir -p ./src/sdk
cp ../../task-B/dist/index.js ./src/sdk/index.js
```

### 3. Import the SDK in Your Code

In your React components, import SDK functions like this:
```js
import { encryptBlob, decryptBlob, recordAndDetectVoice } from './sdk/index';
```
**Do NOT** import from `@solace/client-sdk` or use npm/yarn link.

### 4. Verify the SDK Import
- Start the app (`npm start`).
- Try to use the voice recording feature.
- If you see errors like "Cannot find module './sdk/index'" or voice features are disabled, check that you copied the file correctly.

### 5. Troubleshooting
- If you rebuild the SDK in Task B, **recopy** the file to Task C.
- If you see import errors, check the file path and that `index.js` exists in `src/sdk/`.
- If voice features do not work, double-check all steps above.

---

## Features

- **Voice Capture & VAD:** Record your voice with real-time voice activity detection (VAD) using the @solace/client-sdk (imported via a local file copy in `src/sdk/`, not as an npm package).
- **ASR (Speech-to-Text):** Transcribe speech to text using OpenAI Whisper or another ASR API.
- **Chatbot:** Send transcripts to OpenAI GPT-3.5/4 and receive intelligent responses.
- **TTS (Text-to-Speech):** Play responses using AWS Polly (via a local proxy) with selectable voices.
- **UI/UX:** Simple wireframe interface with buttons for Talk, Stop, Play Response, and a dropdown for voice selection.
- **Error Handling:** All errors (mic, network, decryption, etc.) are surfaced in the UI.
- **(Optional) Local Memory Layer:** Securely store the last 3 transcripts in encrypted form in your browser’s localStorage.

---

## Setup

### 1. Install Dependencies

```sh
cd task-c/client
npm install
```

### 2. SDK Import (Important!)

> **Note:** Due to Create React App limitations, the SDK is imported via a local file copy in `src/sdk/index.js` (copied from `task-B/dist/index.js`), not as an npm package. You must copy the built SDK into `src/sdk/` and import as:
> ```js
> import { encryptBlob, decryptBlob, recordAndDetectVoice } from './sdk/index';
> ```

### 3. Environment Variables

Create a `.env` file in this directory (see `.env.example` for required variables):

```env
REACT_APP_OPENAI_API_KEY=your_openai_api_key
REACT_APP_ASR_API_URL=https://api.openai.com/v1/audio/transcriptions
REACT_APP_CHAT_API_URL=https://api.openai.com/v1/chat/completions
# Add any other required variables here
```

**Note:** Do NOT commit secrets to version control.

### 4. (Optional) Set Up Local Polly Proxy for TTS

To enable Text-to-Speech, run the local AWS Polly proxy:

```sh
# In the project root
npm install express aws-sdk cors dotenv
node polly-proxy.js
```

This will start a server at `http://localhost:5000/tts` used by the app for TTS.

---

## Running the Demo

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Usage

- **Talk:** Click to start recording. Speak into your mic.
- **Stop:** Click to stop and transcribe.
- **Play Response:** Listen to the AI’s reply with your chosen voice.
- **Voice Selection:** Choose between available voices (e.g., male/female).
- **(Optional) Memory:** The last 3 transcripts are securely stored in your browser (encrypted).

---

## Local Memory Layer (Optional)

The app can securely store your last 3 transcripts in the browser’s localStorage, encrypted using the @solace/client-sdk (imported via a local file copy in `src/sdk/`). This means your recent conversation history is private—even if someone accesses your device, they cannot read your transcripts without the decryption key.

---

## Tests

To run tests (if implemented):

```sh
npm test
```

---

## Environment Variables Reference

- `REACT_APP_OPENAI_API_KEY` – Your OpenAI API key (required for ASR and chatbot)
- `REACT_APP_ASR_API_URL` – ASR endpoint (default: OpenAI Whisper)
- `REACT_APP_CHAT_API_URL` – Chatbot endpoint (default: OpenAI GPT)
- (Add any others as needed)

---

## Security Notes

- All sensitive data is encrypted before storage or transmission.
- No secrets are committed to the repository.
- IAM and API keys should be scoped with least privilege.

---

## Troubleshooting

- **TTS not working?** Make sure the local Polly proxy is running.
- **ASR/Chatbot errors?** Check your API keys and endpoints.
- **Mic issues?** Ensure your browser has permission to access the microphone.

## Architecture Flow

### Main Chat Demo Flow
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
*This is the main flow for the voice-to-voice companion demo. S3 and Lambda are not used in this flow.*

### Optional Encrypted Memory Layer
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

## Last note - this might be a bit confusing so feel free to email me at hansenyang@berkeley.edu for clarification


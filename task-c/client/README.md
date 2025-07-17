# Task C: Solace Lite End-to-End Demo

---

## Quick Start

1. **Install dependencies:**
   ```sh
   cd task-c/client
   npm install
   ```

2. **Add your environment variables:**
   - Copy `.env.example` to `.env` and fill in your API keys and endpoints.

3. **(Optional) Enable Text-to-Speech (TTS):**
   - In the project root, run:
     ```sh
     npm install express aws-sdk cors dotenv
     node polly-proxy.js
     ```
   - This starts a local AWS Polly proxy for TTS at `http://localhost:5000/tts`.

4. **Run the app:**
   ```sh
   npm start
   ```
   - Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Notes

- The SDK required for voice and encryption features is **already included** in `src/sdk/index.js`.
- **You do NOT need to build or copy the SDK** unless you want to update it. If you do, see the SDK update instructions at the end of this file.
- All other features (ASR, Chatbot, TTS, encrypted memory) work out of the box after setup.

---

## Features

- **Voice Capture & VAD:** Real-time voice activity detection (VAD) using the included SDK.
- **ASR (Speech-to-Text):** Transcribe speech to text using OpenAI Whisper or another ASR API.
- **Chatbot:** Send transcripts to OpenAI GPT-3.5/4 and receive intelligent responses.
- **TTS (Text-to-Speech):** Play responses using AWS Polly (via a local proxy).
- **UI/UX:** Simple interface with Talk, Stop, Play Response, and voice selection.
- **Error Handling:** All errors are surfaced in the UI.
- **(Optional) Local Memory Layer:** Securely store the last 3 transcripts in encrypted form in your browser.

---

## Usage

- **Talk:** Click to start recording. Speak into your mic.
- **Stop:** Click to stop and transcribe.
- **Play Response:** Listen to the AI’s reply with your chosen voice.
- **Voice Selection:** Choose between available voices.
- **(Optional) Memory:** The last 3 transcripts are securely stored in your browser (encrypted).

---

## Environment Variables Reference

- `REACT_APP_OPENAI_API_KEY` – Your OpenAI API key (required for ASR and chatbot)
- `REACT_APP_ASR_API_URL` – ASR endpoint (default: OpenAI Whisper)
- `REACT_APP_CHAT_API_URL` – Chatbot endpoint (default: OpenAI GPT)
- (Add any others as needed)

---

## Updating the SDK (Only if Needed)

If you want to update the SDK (e.g., after editing the TypeScript source):
1. Build the SDK in Task B:
   ```sh
   cd ../../task-B
   npm install
   npm run build
   ```
2. Copy the built SDK to Task C:
   ```sh
   cp dist/index.js ../task-c/client/src/sdk/index.js
   ```
3. Restart the Task C app if it’s running.

---

## Troubleshooting

- **TTS not working?** Make sure the local Polly proxy is running.
- **ASR/Chatbot errors?** Check your API keys and endpoints.
- **Mic issues?** Ensure your browser has permission to access the microphone.

---

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

---

For questions, email hansenyang@berkeley.edu


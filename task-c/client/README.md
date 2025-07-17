# Task C: Solace Lite End-to-End Demo

---

## Quick Start

1. **Install dependencies:**
   ```sh
   cd task-c/client
   npm install
   ```

2. **Add your environment variables:**
   - Make a .env in task-c/client and fill in your variables (only the task-c specific variables, aka REACT_APP_OPENAI_API_KEY, REACT_APP_TTS_REGION, and REACT_APP_TTS_VOICE_ID=Mei).

3. **(Optional) Enable Text-to-Speech (TTS):**
   - In the project root, run:
     ```sh
     npm install express aws-sdk cors dotenv
     node polly-proxy.js
     ```
   - This starts a local AWS Polly proxy for TTS at `http://localhost:5000/tts`. Again, make sure you have a .env at the root with AWS_ACCESS_KEY_ID=... , AWS_SECRET_ACCESS_KEY=... , and AWS_REGION=... for TTS to work.

4. **Run the app:**
   ```sh
   npm start
   ```
   - Open [http://localhost:3000](http://localhost:3000) in your browser.

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
- `REACT_APP_TTS_REGION` - region (I used us-east-1)
- `REACT_APP_TTS_VOICE_ID` - default TTS voice (I set it to Mei, but Aria works too I believe)
  
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


# Task C: Solace Lite End-to-End Demo

A minimal, privacy-preserving voice companion demo. Capture voice, transcribe to text, chat with an AI, and play back responses with customizable voices—all in your browser.

---

## Features

- **Voice Capture & VAD:** Record your voice with real-time voice activity detection (VAD) using the @solace/client-sdk.
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

### 2. Environment Variables

Create a `.env` file in this directory (see `.env.example` for required variables):

```env
REACT_APP_OPENAI_API_KEY=your_openai_api_key
REACT_APP_ASR_API_URL=https://api.openai.com/v1/audio/transcriptions
REACT_APP_CHAT_API_URL=https://api.openai.com/v1/chat/completions
# Add any other required variables here
```

**Note:** Do NOT commit secrets to version control.

### 3. (Optional) Set Up Local Polly Proxy for TTS

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

The app can securely store your last 3 transcripts in the browser’s localStorage, encrypted using the @solace/client-sdk. This means your recent conversation history is private—even if someone accesses your device, they cannot read your transcripts without the decryption key.

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

---

## License

MIT (or your chosen license)


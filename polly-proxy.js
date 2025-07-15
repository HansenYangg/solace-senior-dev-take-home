const express = require('express');
const AWS = require('aws-sdk');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const polly = new AWS.Polly();

app.post('/tts', async (req, res) => {
  console.log('TTS request:', req.body); // Log incoming request
  const { text, voiceId = 'Mei' } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const params = {
    OutputFormat: 'mp3',
    Text: text,
    VoiceId: voiceId,
    Engine: 'neural',
  };

  try {
    const data = await polly.synthesizeSpeech(params).promise();
    res.set('Content-Type', 'audio/mpeg');
    res.send(data.AudioStream);
  } catch (err) {
    console.error('Polly error:', err); // Log Polly errors
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Polly proxy listening on port ${port}`);
}); 
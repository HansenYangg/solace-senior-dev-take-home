/// <reference types="jest" />
// VAD is now handled by Silero VAD (@ricky0123/vad-web). The old energy-based detectVoiceActivity is no longer present.
// Direct unit tests for detectVoiceActivity are obsolete and have been removed.

// Note: Full integration test for recordAndDetectVoice would require browser APIs mocking (audio context, media stream, etc.)
// This is best done with a browser automation tool or a more advanced mock setup. 
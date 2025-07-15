/// <reference types="jest" />
import { detectVoiceActivity } from '../index';

describe('VAD: detectVoiceActivity', () => {
  it('should detect silence as no voice', () => {
    const silence = new Float32Array(480).fill(0);
    expect(detectVoiceActivity(silence, 2)).toBe(false);
  });

  it('should detect loud signal as voice', () => {
    const loud = new Float32Array(480).fill(0.5);
    expect(detectVoiceActivity(loud, 2)).toBe(true);
  });

  it('should be more sensitive at higher sensitivity', () => {
    const quiet = new Float32Array(480).fill(0.01);
    // Sensitivity 0 (least sensitive) should not detect
    expect(detectVoiceActivity(quiet, 0)).toBe(false);
    // Sensitivity 3 (most sensitive) should detect
    expect(detectVoiceActivity(quiet, 3)).toBe(true);
  });
});

// Note: Full integration test for recordAndDetectVoice would require browser APIs mocking (audio context, media stream, etc.)
// This is best done with a browser automation tool or a more advanced mock setup. 
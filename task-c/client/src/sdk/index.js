/* eslint-disable no-undef */
// Solace Client SDK - src/index.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
// Helper functions for base64 encoding/decoding 
function arrayBufferToBase64(buffer) {
    const uint8Array = new Uint8Array(buffer);
    const chars = Array.from(uint8Array, byte => String.fromCharCode(byte));
    return btoa(chars.join(''));
}
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
// Encryption APIs
export function encryptBlob(data, key) {
    return __awaiter(this, void 0, void 0, function* () {
        const enc = new TextEncoder();
        // Use provided key or generate a new one
        const useKey = key || (yield window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = enc.encode(data);
        const encrypted = yield window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, useKey, encoded);
        // AES-GCM ciphertext includes the tag at the end
        // We'll split it for API compatibility
        const tagLength = 16; // 128 bits
        const ciphertextBytes = new Uint8Array(encrypted);
        const tag = ciphertextBytes.slice(ciphertextBytes.length - tagLength);
        const ciphertext = ciphertextBytes.slice(0, ciphertextBytes.length - tagLength);
        return {
            iv: arrayBufferToBase64(iv.buffer),
            ciphertext: arrayBufferToBase64(ciphertext.buffer),
            tag: arrayBufferToBase64(tag.buffer),
        };
    });
}
export function decryptBlob(_a, key_1) {
    return __awaiter(this, arguments, void 0, function* ({ iv, ciphertext, tag }, key) {
        const dec = new TextDecoder();
        const ivBuf = base64ToArrayBuffer(iv);
        const ciphertextBuf = base64ToArrayBuffer(ciphertext);
        const tagBuf = base64ToArrayBuffer(tag);
        // Concatenate ciphertext and tag
        const fullCipher = new Uint8Array(ciphertextBuf.byteLength + tagBuf.byteLength);
        fullCipher.set(new Uint8Array(ciphertextBuf), 0);
        fullCipher.set(new Uint8Array(tagBuf), ciphertextBuf.byteLength);
        const decrypted = yield window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(ivBuf) }, key, fullCipher);
        return dec.decode(decrypted);
    });
}
// Default VAD configuration
const DEFAULT_VAD_CONFIG = {
    sensitivity: 2,
    frameDuration: 30,
    sampleRate: 16000
};
/**
 * Records audio from microphone and yields only frames containing voice activity.
 * Uses WebRTC VAD to detect speech in real-time.
 *
 * @param config Optional VAD configuration
 * @returns AsyncIterable yielding frames with voice activity
 */
export function recordAndDetectVoice() {
    return __asyncGenerator(this, arguments, function* recordAndDetectVoice_1(config = {}) {
        console.log('=== VAD: Function called ===');
        const vadConfig = Object.assign(Object.assign({}, DEFAULT_VAD_CONFIG), config);
        // Validate configuration
        if (vadConfig.sensitivity < 0 || vadConfig.sensitivity > 3) {
            throw new Error('VAD sensitivity must be between 0 and 3');
        }
        if (![10, 20, 30].includes(vadConfig.frameDuration)) {
            throw new Error('VAD frame duration must be 10, 20, or 30 ms');
        }
        if (![8000, 16000, 32000, 48000].includes(vadConfig.sampleRate)) {
            throw new Error('VAD sample rate must be 8000, 16000, 32000, or 48000 Hz');
        }
        console.log('VAD: Starting voice detection with config:', vadConfig);
        // Request microphone access
        console.log('VAD: Requesting microphone access...');
        let stream;
        try {
            stream = yield __await(navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: vadConfig.sampleRate,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            }));
            console.log('VAD: Got microphone stream successfully');
        }
        catch (error) {
            console.error('VAD: Failed to get microphone stream:', error);
            throw error;
        }
        // Create audio context
        console.log('VAD: Creating audio context...');
        const audioContext = new AudioContext({ sampleRate: vadConfig.sampleRate });
        console.log('VAD: Audio context created, state:', audioContext.state);
        const source = audioContext.createMediaStreamSource(stream);
        console.log('VAD: Media stream source created');
        // Calculate frame size in samples
        const frameSize = (vadConfig.sampleRate * vadConfig.frameDuration) / 1000;
        console.log('VAD: Frame size in samples:', frameSize);
        // Create buffer for processing
        const buffer = new Float32Array(frameSize);
        let bufferIndex = 0;
        // Create script processor for real-time processing
        console.log('VAD: Creating script processor...');
        const processor = audioContext.createScriptProcessor(512, 1, 1);
        console.log('VAD: Script processor created');
        let frameCount = 0;
        const startTime = Date.now();
        // Set up frame queue and control
        const frameQueue = [];
        let isDone = false;
        let audioProcessed = false;
        let resolveNext = null;
        // Set up audio processing
        console.log('VAD: Setting up audio processing...');
        processor.onaudioprocess = (event) => {
            if (isDone)
                return;
            if (!audioProcessed) {
                console.log('VAD: First audio process event received!');
                audioProcessed = true;
            }
            const input = event.inputBuffer.getChannelData(0);
            // Fill buffer
            for (let i = 0; i < frameSize; i++) {
                buffer[bufferIndex] = input[i];
                bufferIndex++;
                if (bufferIndex >= frameSize) {
                    // Process complete frame
                    const hasVoice = detectVoiceActivity(buffer, vadConfig.sensitivity);
                    if (hasVoice) {
                        // Convert to 16-bit PCM for compatibility
                        const pcmFrame = convertToPCM(buffer);
                        const timestamp = startTime + (frameCount * vadConfig.frameDuration);
                        console.log(`VAD: Voice detected! Frame ${frameCount}, timestamp ${timestamp}`);
                        const frameData = {
                            frame: pcmFrame,
                            timestamp
                        };
                        // Add to queue or resolve immediately
                        if (resolveNext) {
                            console.log('VAD: Resolving immediately with frame');
                            resolveNext(frameData);
                            resolveNext = null;
                        }
                        else {
                            console.log('VAD: Adding frame to queue');
                            frameQueue.push(frameData);
                        }
                    }
                    else {
                        // Log some non-voice frames too for debugging
                        if (Math.random() < 0.1) { // Log 10% of non-voice frames
                            console.log(`VAD: No voice in frame ${frameCount}`);
                        }
                    }
                    bufferIndex = 0;
                    frameCount++;
                }
            }
        };
        // Connect audio nodes
        console.log('VAD: Connecting audio nodes...');
        source.connect(processor);
        processor.connect(audioContext.destination);
        console.log('VAD: Audio nodes connected');
        // Resume audio context if it's suspended
        console.log('VAD: Checking audio context state...');
        if (audioContext.state === 'suspended') {
            console.log('VAD: Resuming suspended audio context...');
            yield __await(audioContext.resume());
        }
        console.log('VAD: Audio context state:', audioContext.state);
        // Create a proper async generator
        console.log('VAD: Starting async generator loop...');
        try {
            while (!isDone) {
                console.log('VAD Generator: Waiting for next frame...');
                // Wait for the next frame
                const frame = yield __await(new Promise((resolve) => {
                    // If we have frames in queue, return immediately
                    if (frameQueue.length > 0) {
                        console.log('VAD Generator: returning frame from queue');
                        const frame = frameQueue.shift();
                        resolve(frame);
                        return;
                    }
                    // Otherwise, wait for the next frame
                    console.log('VAD Generator: waiting for next frame');
                    resolveNext = resolve;
                }));
                console.log('VAD Generator: Yielding frame');
                yield yield __await(frame);
            }
        }
        finally {
            // Cleanup
            console.log('VAD: Cleaning up');
            isDone = true;
            stream.getTracks().forEach(track => track.stop());
            source.disconnect();
            processor.disconnect();
            audioContext.close();
        }
    });
}
/**
 * Simple energy-based voice activity detection.
 * In a production environment, use webrtcvad for better accuracy.
 */
export function detectVoiceActivity(buffer, sensitivity) {
    // Calculate RMS (Root Mean Square) energy
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sum / buffer.length);
    // Threshold based on sensitivity (0-3)
    // Lower threshold = more sensitive
    const thresholds = [0.001, 0.0005, 0.0002, 0.0001]; // Much more sensitive thresholds for testing
    const threshold = thresholds[sensitivity] || 0.0002;
    // Add some debugging
    if (Math.random() < 0.01) { // Log 1% of frames to avoid spam
        console.log(`VAD: RMS=${rms.toFixed(6)}, threshold=${threshold.toFixed(6)}, sensitivity=${sensitivity}`);
    }
    return rms > threshold;
}
/**
 * Convert Float32Array to 16-bit PCM ArrayBuffer
 */
function convertToPCM(float32Array) {
    const pcmArray = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        // Convert float32 (-1 to 1) to int16 (-32768 to 32767)
        const sample = Math.max(-1, Math.min(1, float32Array[i]));
        pcmArray[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    return pcmArray.buffer;
}
// --- Upload/Download Helpers ---
export function uploadBlob(blob, apiUrl, token) {
    return __awaiter(this, void 0, void 0, function* () {
        // POST the blob to the Task A endpoint, return blobKey
        const formData = new FormData();
        formData.append('file', blob);
        // Optionally add token for auth
        const headers = {};
        if (token)
            headers['Authorization'] = `Bearer ${token}`;
        const response = yield fetch(apiUrl, {
            method: 'POST',
            body: formData,
            headers,
        });
        if (!response.ok)
            throw new Error(`Upload failed: ${response.statusText}`);
        const data = yield response.json();
        if (!data.blobKey)
            throw new Error('No blobKey returned from server');
        return data.blobKey;
    });
}
export function downloadAndDecrypt(blobKey, apiUrl, key) {
    return __awaiter(this, void 0, void 0, function* () {
        // Download from Task A endpoint and decrypt
        const response = yield fetch(`${apiUrl}?blobKey=${encodeURIComponent(blobKey)}`);
        if (!response.ok)
            throw new Error(`Download failed: ${response.statusText}`);
        const data = yield response.json();
        if (!data.plaintext)
            throw new Error('No plaintext returned from server');
        // The plaintext is base64-encoded
        const plaintextBuf = base64ToArrayBuffer(data.plaintext);
        const dec = new TextDecoder();
        return dec.decode(plaintextBuf);
    });
}
// --- S3 Direct Upload/Download via Presigned URLs ---
/**
 * Uploads a Blob directly to S3 using a presigned URL.
 * @param blob The Blob to upload
 * @param presignedUrl The presigned S3 URL for PUT
 * @returns The S3 object key (if known), or void
 */
export function uploadBlobToS3(blob, presignedUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch(presignedUrl, {
            method: 'PUT',
            body: blob,
            // No custom headers unless required by the presigned URL
        });
        if (!response.ok)
            throw new Error(`S3 upload failed: ${response.statusText}`);
    });
}
/**
 * Downloads a Blob directly from S3 using a presigned URL.
 * @param presignedUrl The presigned S3 URL for GET
 * @returns The downloaded Blob
 */
export function downloadBlobFromS3(presignedUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch(presignedUrl);
        if (!response.ok)
            throw new Error(`S3 download failed: ${response.statusText}`);
        return yield response.blob();
    });
}
/**
 * Expected backend endpoints (Task A) for presigned URL flow:
 *   POST /get-upload-url { filename } => { url, key }
 *   GET  /get-download-url?key=... => { url }
 *
 * The SDK should:
 *   1. Request a presigned upload URL from the backend
 *   2. PUT the file to S3 using uploadBlobToS3
 *   3. Store the returned S3 key
 *   4. Request a presigned download URL from the backend using the key
 *   5. GET the file from S3 using downloadBlobFromS3
 */ 

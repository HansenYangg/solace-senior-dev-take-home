// Test setup for browser APIs

declare global {
  var global: any;
  var jest: any;
  var Buffer: any;
}

// Mock browser APIs for Node.js environment
(global as any).TextEncoder = class TextEncoder {
  encode(str: string): Uint8Array {
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }
};

(global as any).TextDecoder = class TextDecoder {
  decode(arr: Uint8Array): string {
    return Buffer.from(arr).toString('utf8');
  }
};

// Mock Web Crypto API
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      generateKey: jest.fn(),
      encrypt: jest.fn(),
      decrypt: jest.fn(),
    },
    getRandomValues: jest.fn(),
  },
});

// Mock navigator.mediaDevices
Object.defineProperty(global, 'navigator', {
  value: {
    mediaDevices: {
      getUserMedia: jest.fn(),
    },
  },
});

// Mock AudioContext
(global as any).AudioContext = jest.fn().mockImplementation(() => ({
  createMediaStreamSource: jest.fn(),
  createScriptProcessor: jest.fn(),
  sampleRate: 16000,
  close: jest.fn(),
}));

// Mock fetch
(global as any).fetch = jest.fn(); 
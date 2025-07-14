import { encryptBlob, decryptBlob } from '../index';

// Mock crypto API
const mockCrypto = {
  subtle: {
    generateKey: jest.fn(),
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  },
  getRandomValues: jest.fn(),
};

Object.defineProperty(global, 'crypto', {
  value: mockCrypto,
});

describe('Encryption/Decryption', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock crypto key
    const mockKey = { type: 'secret', algorithm: { name: 'AES-GCM' } };
    mockCrypto.subtle.generateKey.mockResolvedValue(mockKey);
    
    // Mock random values for IV
    mockCrypto.getRandomValues.mockReturnValue(new Uint8Array(12).fill(1));
    
    // Mock encryption
    const mockEncrypted = new Uint8Array(32).fill(2);
    mockCrypto.subtle.encrypt.mockResolvedValue(mockEncrypted);
    
    // Mock decryption
    const mockDecrypted = new TextEncoder().encode('test data');
    mockCrypto.subtle.decrypt.mockResolvedValue(mockDecrypted);
  });

  describe('encryptBlob', () => {
    it('should encrypt data and return iv, ciphertext, and tag', async () => {
      const testData = 'hello world';
      const result = await encryptBlob(testData);
      
      expect(result).toHaveProperty('iv');
      expect(result).toHaveProperty('ciphertext');
      expect(result).toHaveProperty('tag');
      expect(typeof result.iv).toBe('string');
      expect(typeof result.ciphertext).toBe('string');
      expect(typeof result.tag).toBe('string');
    });

    it('should call crypto.subtle.generateKey with correct parameters', async () => {
      await encryptBlob('test');
      
      expect(mockCrypto.subtle.generateKey).toHaveBeenCalledWith(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    });

    it('should call crypto.subtle.encrypt with correct parameters', async () => {
      const testData = 'test data';
      await encryptBlob(testData);
      
      expect(mockCrypto.subtle.encrypt).toHaveBeenCalledWith(
        { name: 'AES-GCM', iv: expect.any(Uint8Array) },
        expect.any(Object),
        expect.any(Uint8Array)
      );
    });
  });

  describe('decryptBlob', () => {
    it('should decrypt data correctly', async () => {
      const mockKey = { type: 'secret', algorithm: { name: 'AES-GCM' } };
      const encryptedData = {
        iv: 'AQEBAQEBAQEBAQEBAQ==', // base64 of 12 bytes of 1s
        ciphertext: 'AgICAgICAgICAgICAgICAgICAgICAg==', // base64 of 16 bytes of 2s
        tag: 'AwMDAwMDAwMDAwMDAwMDAwA==' // base64 of 16 bytes of 3s
      };
      
      const result = await decryptBlob(encryptedData, mockKey as CryptoKey);
      
      expect(result).toBe('test data');
    });

    it('should call crypto.subtle.decrypt with correct parameters', async () => {
      const mockKey = { type: 'secret', algorithm: { name: 'AES-GCM' } };
      const encryptedData = {
        iv: 'AQEBAQEBAQEBAQEBAQ==',
        ciphertext: 'AgICAgICAgICAgICAgICAgICAgICAg==',
        tag: 'AwMDAwMDAwMDAwMDAwMDAwA=='
      };
      
      await decryptBlob(encryptedData, mockKey as CryptoKey);
      
      expect(mockCrypto.subtle.decrypt).toHaveBeenCalledWith(
        { name: 'AES-GCM', iv: expect.any(Uint8Array) },
        mockKey,
        expect.any(Uint8Array)
      );
    });
  });

  describe('Error handling', () => {
    it('should handle encryption errors', async () => {
      mockCrypto.subtle.encrypt.mockRejectedValue(new Error('Encryption failed'));
      
      await expect(encryptBlob('test')).rejects.toThrow('Encryption failed');
    });

    it('should handle decryption errors', async () => {
      mockCrypto.subtle.decrypt.mockRejectedValue(new Error('Decryption failed'));
      
      const mockKey = { type: 'secret', algorithm: { name: 'AES-GCM' } };
      const encryptedData = {
        iv: 'AQEBAQEBAQEBAQEBAQ==',
        ciphertext: 'AgICAgICAgICAgICAgICAgICAgICAg==',
        tag: 'AwMDAwMDAwMDAwMDAwMDAwA=='
      };
      
      await expect(decryptBlob(encryptedData, mockKey as CryptoKey)).rejects.toThrow('Decryption failed');
    });
  });
}); 
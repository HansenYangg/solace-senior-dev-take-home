declare module '@solace/client-sdk' {
  export interface VADConfig {
    sensitivity?: number;
    frameDuration?: number;
    sampleRate?: number;
  }

  export function encryptBlob(data: string): Promise<{
    iv: string;
    ciphertext: string;
    tag: string;
  }>;

  export function decryptBlob(
    encrypted: { iv: string; ciphertext: string; tag: string },
    key: CryptoKey
  ): Promise<string>;

  export function recordAndDetectVoice(config?: VADConfig): AsyncIterable<{
    frame: ArrayBuffer;
    timestamp: number;
  }>;

  export function uploadBlob(blob: Blob, apiUrl: string, token?: string): Promise<string>;
  
  export function downloadAndDecrypt(blobKey: string, apiUrl: string, key: CryptoKey): Promise<string>;
  
  export function uploadBlobToS3(blob: Blob, presignedUrl: string): Promise<void>;
  
  export function downloadBlobFromS3(presignedUrl: string): Promise<Blob>;
} 
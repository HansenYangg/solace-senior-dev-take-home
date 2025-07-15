// Node.js usage example for @solace/client-sdk
// Requires Node.js 19+ for globalThis.crypto.webcrypto
// Run with: node --experimental-global-webcrypto src/__tests__/node-example.ts

import { encryptBlob, decryptBlob } from '../index';

async function main() {
  // Example: Encrypt and decrypt a string
  const data = 'Hello from Node.js!';
  const { iv, ciphertext, tag } = await encryptBlob(data);
  console.log('Encrypted:', { iv, ciphertext, tag });

  // Generate a key for decryption (simulate round-trip)
  // In real use, you'd persist/export/import the key
  const key = await globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  // Decrypt
  const plaintext = await decryptBlob({ iv, ciphertext, tag }, key);
  console.log('Decrypted:', plaintext);
}

main().catch(console.error);

// Note: VAD and audio APIs are not available in Node.js (browser only) 
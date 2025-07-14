# Solace Senior Developer Take-Home

A secure voice processing system with enclave-style decryption, cross-platform client SDK, and end-to-end voice companion demo.

## Project Structure

- **task-A/**: Enclave-Style Decryption Service (AWS Lambda + KMS)
- **task-B/**: Cross-Platform Client SDK (@solace/client-sdk)
- **task-C/**: Solace Lite End-to-End Demo (Voice → Voice Companion)

## Prerequisites

- Node.js (>=16.x)
- Python (>=3.9)
- AWS CLI
- Docker
- Git
- AWS SAM CLI

## Quick Start

1. **Task A**: Deploy the decryption service
   ```bash
   cd task-A
   # Follow setup instructions in task-A/README.md
   ```

2. **Task B**: Install and test the client SDK
   ```bash
   cd task-B
   # Follow setup instructions in task-B/README.md
   ```

3. **Task C**: Run the end-to-end demo
   ```bash
   cd task-C
   # Follow setup instructions in task-C/README.md
   ```

## Submission Checklist

- [ ] Task A: Lambda decryption service deployed and tested
- [ ] Task B: Client SDK published and demo working
- [ ] Task C: End-to-end voice companion demo running
- [ ] All README files completed with setup instructions
- [ ] Security best practices implemented
- [ ] Tests passing across all components
- [ ] .env.example files provided (no secrets included)

## Architecture Overview

```
User Voice Input → Task B SDK (Encrypt) → S3 → Task A Lambda (Decrypt) → Task C (ASR → Chatbot → TTS) → Voice Output
```

## Security Features

- AES-GCM 256 encryption for data in transit
- AWS KMS for secure key management
- Least-privilege IAM policies
- Encryption at rest on S3
- TEE-style isolation using Lambda + KMS
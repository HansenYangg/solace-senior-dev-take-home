# Task A: Enclave-Style Decryption Service

## Overview
This service emulates a Trusted Execution Environment (TEE) using AWS Lambda, KMS, and S3 to provide secure, enclave-style decryption of encrypted blobs. Only the Lambda function can decrypt data, ensuring "data in use" security.

---

## Features
- **Lambda handler** receives a POST request with a `blobKey` (S3 object key)
- Fetches encrypted blob from S3
- Decrypts blob using AWS KMS (with IAM policy restricting decryption to this Lambda)
- Returns `{ "plaintext": <base64 string> }` over HTTPS with CORS headers
- Infrastructure as Code (AWS SAM): Lambda, KMS key, S3 bucket, API Gateway
- Security best practices: least-privilege IAM, encryption at rest, environment variables for config

---

## Prerequisites
- AWS account with permissions for Lambda, KMS, S3, IAM
- AWS CLI configured (`aws configure`)
- AWS SAM CLI installed
- Node.js (>=16.x) and Python (>=3.9) for local testing

---

## Setup & Deployment

1. **Clone the repository**
2. **Navigate to the infra directory:**
   ```sh
   cd task-A/infra/solace sam
   ```
3. **Build the SAM application:**
   ```sh
   sam build
   ```
4. **Deploy the stack:**
   ```sh
   sam deploy --guided
   ```
   - Use a unique S3 bucket name and KMS alias as prompted
   - Allow SAM to create IAM roles
   - Accept all other defaults

5. **Deployment outputs:**
   - API endpoint URL (e.g., `https://...execute-api.../Prod/decrypt/`)
   - S3 bucket name
   - KMS key ARN

---

## API Usage

### **POST /decrypt**
- **Request Body:**
  ```json
  { "blobKey": "<s3-object-key>" }
  ```
- **Response:**
  ```json
  { "plaintext": "<base64-encoded-plaintext>" }
  ```
- **CORS:**
  - `Access-Control-Allow-Origin: *`

---

## Security Notes
- Only the deployed Lambda can decrypt using the KMS key (enforced by IAM policy)
- S3 bucket is encrypted at rest with KMS
- Lambda uses least-privilege IAM roles
- All configuration is via environment variables

---

## End-to-End Test Script
A sample script (`decrypt_test.sh`) is provided to:
- Encrypt a test message with KMS
- Upload the encrypted blob to S3
- Call the Lambda endpoint and decode the result

**Usage:**
1. Edit the script to set your KMS key ARN, S3 bucket name, and API URL (from your deployment outputs)
2. Run the script in Git Bash or WSL:
   ```sh
   ./decrypt_test.sh
   ```

---

## Example curl Invocation
```sh
curl -X POST "<API_URL>/decrypt/" \
  -H "Content-Type: application/json" \
  -d '{"blobKey": "test-encrypted-blob.bin"}'
```

---

## Cleanup
- To remove all resources, delete the CloudFormation stack from the AWS Console.
- Manually delete any test files you created locally.

---

## Deliverables Checklist
- [x] Lambda decryption service deployed and tested
- [x] Infrastructure as code (SAM template)
- [x] Security best practices implemented
- [x] End-to-end test script provided
- [x] README with setup, deployment, and usage instructions 
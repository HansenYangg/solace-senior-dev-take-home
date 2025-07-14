#!/bin/bash
# End-to-end test for Task A: Enclave-Style Decryption Service
# Edit these variables with your deployment outputs:
KMS_KEY_ARN="arn:aws:kms:us-east-1:088597267062:key/b4717c5e-0a18-469a-8a58-cd93063aba98"
S3_BUCKET="solace-encrypted-blobs-hansen-088597267062-20250714"
BLOB_KEY="test-encrypted-blob.bin"
API_URL="https://tnv6dcwi02.execute-api.us-east-1.amazonaws.com/Prod/decrypt/"
PLAINTEXT="hello-solace"

set -e

echo "$PLAINTEXT" > plaintext.txt

# Encrypt the plaintext with KMS
encrypted_b64=$(aws kms encrypt \
  --key-id "$KMS_KEY_ARN" \
  --plaintext fileb://plaintext.txt \
  --output text \
  --query CiphertextBlob)

echo "$encrypted_b64" | base64 --decode > encrypted_blob.bin

# Upload to S3
aws s3 cp encrypted_blob.bin s3://$S3_BUCKET/$BLOB_KEY

# Call the Lambda endpoint
RESPONSE=$(curl -s -X POST "$API_URL" -H "Content-Type: application/json" -d "{\"blobKey\": \"$BLOB_KEY\"}")
echo "Lambda response: $RESPONSE"

# Decode the plaintext from the response
PLAINTEXT_B64=$(echo $RESPONSE | python -c "import sys, json; print(json.load(sys.stdin)['plaintext'])")
echo "Decoded plaintext: "
echo $PLAINTEXT_B64 | base64 --decode

echo "\nTest complete." 
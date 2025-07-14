#!/bin/bash
PLAINTEXT="hello-solace"
KMS_KEY_ARN="arn:aws:kms:us-east-1:088597267062:key/b4717c5e-0a18-469a-8a58-cd93063aba98"
S3_BUCKET="solace-encrypted-blobs-hansen-088597267062-20250714"
BLOB_KEY="test-encrypted-blob.bin"
API_URL="https://tnv6dcwi02.execute-api.us-east-1.amazonaws.com/Prod/decrypt/"

echo "$PLAINTEXT" > plaintext.txt

aws kms encrypt \
  --key-id "$KMS_KEY_ARN" \
  --plaintext fileb://plaintext.txt \
  --output text \
  --query CiphertextBlob | base64 --decode > encrypted_blob.bin

aws s3 cp encrypted_blob.bin s3://$S3_BUCKET/$BLOB_KEY

RESPONSE=$(curl -s -X POST "$API_URL" -H "Content-Type: application/json" -d "{\"blobKey\": \"$BLOB_KEY\"}")
echo "Lambda response: $RESPONSE"

PLAINTEXT_B64=$(echo $RESPONSE | python -c "import sys, json; print(json.load(sys.stdin)['plaintext'])")
echo "Decoded plaintext: "
echo $PLAINTEXT_B64 | base64 --decode
echo
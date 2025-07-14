import json
import boto3
import os
import base64

s3 = boto3.client('s3')
kms = boto3.client('kms')

BUCKET_NAME = os.environ.get('BUCKET_NAME')
KMS_KEY_ARN = os.environ.get('KMS_KEY_ARN')


def lambda_handler(event, context):
    # CORS headers
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    }

    # Handle preflight
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": headers}

    # Only allow POST
    if event.get("httpMethod") != "POST":
        return {"statusCode": 405, "headers": headers, "body": json.dumps({"error": "Method Not Allowed"})}

    try:
        body = json.loads(event.get("body", "{}"))
        blob_key = body.get("blobKey")
        if not blob_key:
            return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": "Missing blobKey"})}

        # Fetch encrypted blob from S3
        s3_obj = s3.get_object(Bucket=BUCKET_NAME, Key=blob_key)
        encrypted_blob = s3_obj['Body'].read()

        # Decrypt with KMS
        decrypt_response = kms.decrypt(
            CiphertextBlob=encrypted_blob,
            KeyId=KMS_KEY_ARN
        )
        plaintext = decrypt_response['Plaintext']
        # Return as base64-encoded string for safety
        plaintext_b64 = base64.b64encode(plaintext).decode('utf-8')

        return {
            "statusCode": 200,
            "headers": headers,
            "body": json.dumps({"plaintext": plaintext_b64})
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps({"error": str(e)})
        }

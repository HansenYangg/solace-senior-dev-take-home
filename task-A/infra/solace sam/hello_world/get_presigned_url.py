import json
import boto3
import os
import uuid
from botocore.client import Config
import base64

s3 = boto3.client('s3', region_name='us-east-1', config=Config(signature_version='s3v4'))
BUCKET_NAME = os.environ.get('BUCKET_NAME')

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
}

def lambda_handler(event, context):
    method = event.get("httpMethod")
    path = event.get("resource") or event.get("path")
    # Handle CORS preflight
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS}

    try:
        print(f"Lambda event: {json.dumps(event)}")
        if not BUCKET_NAME:
            print("BUCKET_NAME environment variable is not set!")
            return {"statusCode": 500, "headers": CORS_HEADERS, "body": json.dumps({"error": "BUCKET_NAME env var not set"})}
        if method == "POST" and (path.endswith("get-upload-url") or path.endswith("/get-upload-url")):
            body = json.loads(event.get("body", "{}"))
            filename = body.get("filename")
            if not filename:
                print("Missing filename in request body")
                return {"statusCode": 400, "headers": CORS_HEADERS, "body": json.dumps({"error": "Missing filename"})}
            # Generate a unique S3 key
            s3key = f"uploads/{uuid.uuid4()}-{filename}"
            print(f"Generating presigned upload URL for key: {s3key}")
            try:
                url = s3.generate_presigned_url(
                    ClientMethod='put_object',
                    Params={
                        'Bucket': BUCKET_NAME,
                        'Key': s3key,
                        'ContentType': 'application/octet-stream',
                        'ServerSideEncryption': 'aws:kms'
                    },
                    ExpiresIn=300  # 5 minutes
                )
            except Exception as e:
                print(f"Failed to generate presigned upload URL: {e}")
                return {"statusCode": 500, "headers": CORS_HEADERS, "body": json.dumps({"error": "Failed to generate presigned URL", "details": str(e)})}
            print(f"Presigned upload URL generated successfully.")
            return {
                "statusCode": 200,
                "headers": CORS_HEADERS,
                "body": json.dumps({"url": url, "key": s3key})
            }
        elif method == "GET" and (path.endswith("get-download-url") or path.endswith("/get-download-url")):
            params = event.get("queryStringParameters") or {}
            s3key = params.get("key")
            print(f"Download requested for key: {s3key}")
            if not s3key:
                print("Missing key in query parameters")
                return {"statusCode": 400, "headers": CORS_HEADERS, "body": json.dumps({"error": "Missing key"})}
            print(f"BUCKET_NAME: {BUCKET_NAME}, s3key: {s3key}")
            try:
                url = s3.generate_presigned_url(
                    ClientMethod='get_object',
                    Params={
                        'Bucket': BUCKET_NAME,
                        'Key': s3key
                    },
                    ExpiresIn=300  # 5 minutes
                )
            except Exception as e:
                print(f"Failed to generate presigned download URL: {e}")
                return {"statusCode": 500, "headers": CORS_HEADERS, "body": json.dumps({"error": "Failed to generate presigned download URL", "details": str(e)})}
            print(f"Presigned download URL generated successfully.")
            return {
                "statusCode": 200,
                "headers": CORS_HEADERS,
                "body": json.dumps({"url": url})
            }
        else:
            print(f"Path not found: {path}")
            return {"statusCode": 404, "headers": CORS_HEADERS, "body": json.dumps({"error": "Not found"})}
    except Exception as e:
        print(f"UNHANDLED ERROR in Lambda: {e}")
        return {"statusCode": 500, "headers": CORS_HEADERS, "body": json.dumps({"error": str(e)})}

def encrypt_and_upload_handler(event, context):
    method = event.get("httpMethod")
    path = event.get("resource") or event.get("path")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS}
    try:
        if method == "POST":
            body = json.loads(event.get("body", "{}"))
            plaintext = body.get("plaintext")
            if not plaintext:
                return {"statusCode": 400, "headers": CORS_HEADERS, "body": json.dumps({"error": "Missing plaintext"})}
            # Encrypt with KMS
            kms = boto3.client('kms')
            KMS_KEY_ARN = os.environ.get('KMS_KEY_ARN')
            encrypt_args = {"KeyId": KMS_KEY_ARN, "Plaintext": plaintext.encode()}
            kms_resp = kms.encrypt(**encrypt_args)
            ciphertext = kms_resp['CiphertextBlob']
            # Store in S3
            s3key = f"uploads/{uuid.uuid4()}-kms.bin"
            s3.put_object(Bucket=BUCKET_NAME, Key=s3key, Body=ciphertext)
            return {"statusCode": 200, "headers": CORS_HEADERS, "body": json.dumps({"key": s3key})}
        else:
            return {"statusCode": 405, "headers": CORS_HEADERS, "body": json.dumps({"error": "Method Not Allowed"})}
    except Exception as e:
        return {"statusCode": 500, "headers": CORS_HEADERS, "body": json.dumps({"error": str(e)})} 
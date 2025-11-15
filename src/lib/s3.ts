// src/lib/s3.ts
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/* ---------- read .env (server-side only) ---------- */
const {
  MINIO_ENDPOINT,
  MINIO_PORT,
  MINIO_USE_SSL,
  MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY,
  MINIO_BUCKET,
} = process.env;

if (!MINIO_ENDPOINT || !MINIO_ACCESS_KEY || !MINIO_SECRET_KEY || !MINIO_BUCKET) {
  throw new Error('Missing MinIO configuration in .env');
}

/**
 * MINIO_ENDPOINT in .env should be either:
 *   82.165.143.125
 * or http://82.165.143.125
 *
 * We normalize it to:  http://82.165.143.125:9900
 */
const protocol = MINIO_USE_SSL === 'true' ? 'https' : 'http';
const host = MINIO_ENDPOINT.replace(/^https?:\/\//, ''); // strip http/https if present
const port = MINIO_PORT || '9000';
const endpoint = `${protocol}://${host}:${port}`;

/* ---------- S3 client (MinIO compatible) ---------- */
const s3 = new S3Client({
  region: 'us-east-1',          // MinIO ignores this
  endpoint,
  credentials: {
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
  forcePathStyle: true,         // required for MinIO
});

/* ---------- public helper ---------- */
export async function createPresignedUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: MINIO_BUCKET!,  // e.g. "mlflow"
    Key: key,               // e.g. "toxicity-binary-text-cls/model.onnx"
  });

  return getSignedUrl(s3, command, { expiresIn });
}

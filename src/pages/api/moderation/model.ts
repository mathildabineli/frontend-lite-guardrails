// src/pages/api/moderation/model.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import * as Minio from 'minio';

/**
 * Unified route:
 *  - GET /api/moderation/model               -> { files: [{file,url}, ...] } (presigned URLs)
 *  - GET /api/moderation/model?file=<name>   -> streams that single file (no CORS needed)
 */

const PREFIX =
  '3/a023cb34c4524ad0bb09c480f05b1f3f/artifacts/microsoft-mdeberta-v3-base_student_20251104-132239_mlflow-model_quantized/' as const;

const REQUIRED_FILES = [
  'model_quantized.onnx',
  'tokenizer.json',
  'config.json',
  'vocab.txt',
  'special_tokens_map.json',
  'tokenizer_config.json',
] as const;

type AllowedFile = (typeof REQUIRED_FILES)[number];

const ALLOWED = new Set<AllowedFile>(REQUIRED_FILES);

function isAllowedFile(x: unknown): x is AllowedFile {
  return typeof x === 'string' && (ALLOWED as Set<string>).has(x);
}

function createMinioClient() {
  const endpoint = (process.env.MINIO_ENDPOINT || '').replace(/^https?:\/\//, '');
  return new Minio.Client({
    endPoint: endpoint,
    port: Number(process.env.MINIO_PORT || '9900'),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || '',
    secretKey: process.env.MINIO_SECRET_KEY || '',
  });
}

const MODERATION_MODEL_ENABLED = process.env.MODERATION_MODEL_ENABLED === 'true' || false;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!MODERATION_MODEL_ENABLED) {
    return res.status(403).json({ error: 'Model access disabled' });
  }

  const bucket = process.env.MINIO_BUCKET || 'mlflow';
  const client = createMinioClient();

  // ---------- STREAM MODE (no CORS) ----------
  // supports ?file=tokenizer.json or ?file=["tokenizer.json"]
  const q = req.query.file;
  const requestedRaw = Array.isArray(q) ? q[0] : q;

  if (requestedRaw !== undefined) {
    if (!isAllowedFile(requestedRaw)) {
      return res.status(400).json({ error: 'invalid file name' });
    }

    const requestedFile: AllowedFile = requestedRaw;

    try {
      const objectName = PREFIX + requestedFile;
      const stat = await client.statObject(bucket, objectName);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Cache-Control', 'public, max-age=300');

      const stream = await client.getObject(bucket, objectName);
      stream.on('error', (err) => {
        console.error('[moderation/model] stream error', err);
        if (!res.headersSent) res.status(500).end('stream error');
      });
      stream.pipe(res);
      return;
    } catch (err: any) {
      console.error('[moderation/model] stream error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
      return;
    }
  }

  // ---------- PRESIGNED URL MODE ----------
  try {
    const files = await Promise.all(
      REQUIRED_FILES.map(async (file) => {
        const objectName = PREFIX + file;
        const url = await client.presignedGetObject(bucket, objectName, 60 * 60); // 1h
        return { file, url };
      })
    );

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json({ files });
  } catch (err: any) {
    console.error('[moderation/model] presigned error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
}
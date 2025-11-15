// src/pages/api/moderation/presign.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createPresignedUrl } from '@/lib/s3';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { file } = req.query;

  if (!file || typeof file !== 'string') {
    return res
      .status(400)
      .json({ error: 'Missing or invalid "file" parameter' });
  }

  try {
    // key = "toxicity-binary-text-cls/model.onnx"
    const url = await createPresignedUrl(file, 60 * 60); // 1 hour
    return res.status(200).json({ url });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[presign] error:', err);
    return res
      .status(500)
      .json({ error: 'Failed to generate presigned URL' });
  }
}

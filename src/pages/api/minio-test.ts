// src/pages/api/minio-test.ts
import * as Minio from 'minio';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  console.log('MINIO_ENDPOINT:', process.env.MINIO_ENDPOINT);
  console.log('MINIO_PORT:', process.env.MINIO_PORT);
  console.log('MINIO_USE_SSL:', process.env.MINIO_USE_SSL);
  console.log('MINIO_ACCESS_KEY:', (process.env.MINIO_ACCESS_KEY || '').slice(0, 3) + '***');

  try {
    const endpoint = process.env.MINIO_ENDPOINT?.replace(/^https?:\/\//, '') || '';
    const port = parseInt(process.env.MINIO_PORT || '9000', 10);
    const useSSL = process.env.MINIO_USE_SSL === 'true';

    const minioClient = new Minio.Client({
      endPoint: endpoint,
      port,
      useSSL,
      accessKey: process.env.MINIO_ACCESS_KEY || '',
      secretKey: process.env.MINIO_SECRET_KEY || '',
    });

    const buckets = await minioClient.listBuckets();
    const bucketNames = buckets.map((bucket) => bucket.name);

    return res.status(200).json({ ok: true, buckets: bucketNames });
  } catch (error: any) {
    console.error('MinIO Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

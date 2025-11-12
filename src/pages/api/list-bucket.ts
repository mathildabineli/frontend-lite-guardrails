import type { NextApiRequest, NextApiResponse } from 'next';
import * as Minio from 'minio';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

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

    const bucket = process.env.MINIO_BUCKET || 'mlflow';
    const objects: { name: string; size: number }[] = []; // Include size for verification
    const stream = minioClient.listObjectsV2(bucket, '', true); // '' prefix to list all

    stream.on('data', (obj) => {
      if (obj.name) {
        objects.push({ name: obj.name, size: obj.size || 0 });
      }
    });

    await new Promise((resolve, reject) => {
      stream.on('end', () => {
        console.log(`Listed ${objects.length} objects from bucket '${bucket}'`);
        resolve(null);
      });
      stream.on('error', reject);
    });

    return res.status(200).json({ ok: true, objects });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('List bucket error:', errMsg);
    return res.status(500).json({ ok: false, error: errMsg });
  }
}
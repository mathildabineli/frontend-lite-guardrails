// src/pages/api/moderation/test.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_: NextApiRequest, res: NextApiResponse) {
  res.json({ ok: true, message: 'Moderation API is alive' });
}

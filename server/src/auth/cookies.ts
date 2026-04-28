import crypto from 'node:crypto';

function getSecret(): string {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error('APP_SECRET env var is required');
  return s;
}

export function signCookie(value: string): string {
  const sig = crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
  return `${value}.${sig}`;
}

export function verifyCookie(signed: string | undefined): string | null {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
      return null;
    }
  } catch {
    return null;
  }
  return value;
}

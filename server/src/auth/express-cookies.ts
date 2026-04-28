import type { Request, Response } from 'express';
import * as cookie from 'cookie';
import { signCookie, verifyCookie } from './cookies.js';

export interface SetCookieOpts {
  maxAgeSeconds: number;
  secure?: boolean;
}

export function setSignedCookie(
  res: Response,
  name: string,
  value: string,
  opts: SetCookieOpts,
): void {
  const signed = signCookie(value);
  const secure = opts.secure ?? process.env.COOKIE_SECURE === '1';
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(name, signed, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: opts.maxAgeSeconds,
    }),
  );
}

export function readSignedCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const parsed = cookie.parse(header);
  return verifyCookie(parsed[name]);
}

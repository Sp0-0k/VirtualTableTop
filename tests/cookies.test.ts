import { describe, it, expect } from 'vitest';
import { signCookie, verifyCookie } from '../server/src/auth/cookies.js';

describe('cookie sign/verify', () => {
  it('round-trips a value through sign and verify', () => {
    const signed = signCookie('hello');
    expect(verifyCookie(signed)).toBe('hello');
  });

  it('round-trips a numeric-looking value', () => {
    const signed = signCookie('42');
    expect(verifyCookie(signed)).toBe('42');
  });

  it('rejects undefined', () => {
    expect(verifyCookie(undefined)).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(verifyCookie('')).toBeNull();
  });

  it('rejects a malformed cookie with no separator', () => {
    expect(verifyCookie('justavalue')).toBeNull();
  });

  it('rejects a tampered value', () => {
    const signed = signCookie('hello');
    const tampered = signed.replace(/^hello/, 'world');
    expect(verifyCookie(tampered)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const signed = signCookie('hello');
    const tampered = signed.slice(0, -1) + (signed.slice(-1) === '0' ? '1' : '0');
    expect(verifyCookie(tampered)).toBeNull();
  });

  it('rejects a value signed with a different secret', () => {
    const signed = signCookie('hello');
    process.env.APP_SECRET = 'different-secret';
    try {
      expect(verifyCookie(signed)).toBeNull();
    } finally {
      process.env.APP_SECRET = 'test-secret-do-not-use-in-prod';
    }
  });

  it('throws if APP_SECRET is unset', () => {
    const original = process.env.APP_SECRET;
    delete process.env.APP_SECRET;
    try {
      expect(() => signCookie('x')).toThrow(/APP_SECRET/);
    } finally {
      process.env.APP_SECRET = original;
    }
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  SESSION_MAX_AGE_MS,
  CLOCK_SKEW_ALLOWANCE_MS,
} from '@/src/lib/session';

describe('Cryptographic Session Tokens & Hardened Verification', () => {
  const originalSecret = process.env.AUTH_SECRET;
  const testSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const testEmail = 'student@cmrit.ac.in';

  beforeEach(() => {
    process.env.AUTH_SECRET = testSecret;
  });

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.AUTH_SECRET = originalSecret;
    } else {
      delete process.env.AUTH_SECRET;
    }
  });

  describe('Secret Configuration & Fail-Closed Behavior', () => {
    it('creates and verifies a valid signed session token when secret is configured', () => {
      const token = createSessionToken(testEmail);
      expect(token).toBeDefined();
      expect(token).toContain('.');

      const verifiedEmail = verifySessionToken(token);
      expect(verifiedEmail).toBe(testEmail);
    });

    it('fails closed: throws clear error without secret disclosure when AUTH_SECRET is missing during token creation', () => {
      delete process.env.AUTH_SECRET;

      expect(() => createSessionToken(testEmail)).toThrowError(
        /AUTH_SECRET environment variable is missing or empty/
      );
      // Ensure the secret value itself is never printed
      try {
        createSessionToken(testEmail);
      } catch (err: any) {
        expect(err.message).not.toContain(testSecret);
      }
    });

    it('fails closed: throws clear error when AUTH_SECRET is below minimum length (16 characters)', () => {
      const shortSecret = 'too-short';
      process.env.AUTH_SECRET = shortSecret;

      expect(() => createSessionToken(testEmail)).toThrowError(
        /AUTH_SECRET environment variable is too short \(minimum 16 characters required\)/
      );
      // Ensure the actual short secret value is not printed
      try {
        createSessionToken(testEmail);
      } catch (err: any) {
        expect(err.message).not.toContain(shortSecret);
      }
    });

    it('fails closed: returns null when AUTH_SECRET is missing during token verification', () => {
      const token = createSessionToken(testEmail);
      delete process.env.AUTH_SECRET;

      const verified = verifySessionToken(token);
      expect(verified).toBeNull();
    });

    it('fails closed: returns null when AUTH_SECRET is below minimum length during token verification', () => {
      const token = createSessionToken(testEmail);
      process.env.AUTH_SECRET = 'short';

      const verified = verifySessionToken(token);
      expect(verified).toBeNull();
    });
  });

  describe('Timestamp Validation & Clock Skew Guard', () => {
    it('rejects future-dated tokens beyond acceptable clock-skew allowance (60s)', () => {
      const futureTime = Date.now() + CLOCK_SKEW_ALLOWANCE_MS + 10_000; // 70 seconds into future
      const payload = `${testEmail}|${futureTime}`;
      const encoded = Buffer.from(payload, 'utf8').toString('base64url');
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', testSecret).update(encoded).digest('hex');
      const futureToken = `${encoded}.${hmac}`;

      expect(verifySessionToken(futureToken)).toBeNull();
    });

    it('accepts tokens within the documented clock-skew allowance (30s in future)', () => {
      const futureTime = Date.now() + 30_000; // 30 seconds into future (<= 60s)
      const payload = `${testEmail}|${futureTime}`;
      const encoded = Buffer.from(payload, 'utf8').toString('base64url');
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', testSecret).update(encoded).digest('hex');
      const skewToken = `${encoded}.${hmac}`;

      expect(verifySessionToken(skewToken)).toBe(testEmail);
    });

    it('rejects expired tokens older than 30 days', () => {
      const expiredTime = Date.now() - (SESSION_MAX_AGE_MS + 10_000); // 30 days + 10 seconds ago
      const payload = `${testEmail}|${expiredTime}`;
      const encoded = Buffer.from(payload, 'utf8').toString('base64url');
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', testSecret).update(encoded).digest('hex');
      const expiredToken = `${encoded}.${hmac}`;

      expect(verifySessionToken(expiredToken)).toBeNull();
    });
  });

  describe('Token Structure & Malformed Input Rejection', () => {
    it('rejects plain unencrypted email strings (mitigates cookie spoofing)', () => {
      expect(verifySessionToken('admin@cmrit.ac.in')).toBeNull();
    });

    it('rejects tokens with non-hex or invalid length signatures', () => {
      const token = createSessionToken(testEmail);
      const [payload] = token.split('.');

      // Wrong length (63 chars)
      const shortSig = `${payload}.${'a'.repeat(63)}`;
      expect(verifySessionToken(shortSig)).toBeNull();

      // Non-hex characters
      const nonHexSig = `${payload}.${'z'.repeat(64)}`;
      expect(verifySessionToken(nonHexSig)).toBeNull();
    });

    it('rejects tokens with invalid payload encoding or extra segments', () => {
      const crypto = require('crypto');
      const invalidPayload = 'not-base64-url!';
      const hmac = crypto.createHmac('sha256', testSecret).update(invalidPayload).digest('hex');
      expect(verifySessionToken(`${invalidPayload}.${hmac}`)).toBeNull();

      // Extra segments
      const threePartPayload = Buffer.from(`${testEmail}|12345|extra`).toString('base64url');
      const hmac3 = crypto.createHmac('sha256', testSecret).update(threePartPayload).digest('hex');
      expect(verifySessionToken(`${threePartPayload}.${hmac3}`)).toBeNull();
    });

    it('rejects tokens containing invalid email format in payload', () => {
      const crypto = require('crypto');
      const badEmailPayload = Buffer.from(`notanemail|${Date.now()}`).toString('base64url');
      const hmac = crypto.createHmac('sha256', testSecret).update(badEmailPayload).digest('hex');
      expect(verifySessionToken(`${badEmailPayload}.${hmac}`)).toBeNull();
    });

    it('rejects tokens with non-numeric or non-safe-integer timestamps', () => {
      const crypto = require('crypto');
      const badTsPayload = Buffer.from(`${testEmail}|notanumber`).toString('base64url');
      const hmac = crypto.createHmac('sha256', testSecret).update(badTsPayload).digest('hex');
      expect(verifySessionToken(`${badTsPayload}.${hmac}`)).toBeNull();

      const negativeTsPayload = Buffer.from(`${testEmail}|-5000`).toString('base64url');
      const hmacNeg = crypto.createHmac('sha256', testSecret).update(negativeTsPayload).digest('hex');
      expect(verifySessionToken(`${negativeTsPayload}.${hmacNeg}`)).toBeNull();
    });

    it('rejects tampered signatures and payloads', () => {
      const token = createSessionToken(testEmail);
      const [payload] = token.split('.');
      const tamperedSig = `${payload}.${'0'.repeat(64)}`;
      expect(verifySessionToken(tamperedSig)).toBeNull();

      const fakePayload = Buffer.from('admin@cmrit.ac.in|' + Date.now()).toString('base64url');
      const [, originalSig] = token.split('.');
      expect(verifySessionToken(`${fakePayload}.${originalSig}`)).toBeNull();
    });

    it('rejects null, undefined, and empty string', () => {
      expect(verifySessionToken(null)).toBeNull();
      expect(verifySessionToken(undefined)).toBeNull();
      expect(verifySessionToken('')).toBeNull();
    });
  });
});

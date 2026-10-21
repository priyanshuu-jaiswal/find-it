import crypto from 'crypto';

export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const CLOCK_SKEW_ALLOWANCE_MS = 60 * 1000; // 60 seconds

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const SIGNATURE_REGEX = /^[0-9a-f]{64}$/i;

export const MIN_AUTH_SECRET_LENGTH = 16;

/**
 * Retrieves the cryptographic secret from environment.
 * Strictly fails closed if AUTH_SECRET is undefined, empty, or below minimum length.
 * Note: While code enforces a minimum length of 16 characters, high entropy (256-bit random)
 * is an operational requirement that operators must fulfill in deployment environments.
 */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
    throw new Error(
      'AUTH_SECRET environment variable is missing or empty. Application fails closed for session security.'
    );
  }
  const cleanSecret = secret.trim();
  if (cleanSecret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error(
      `AUTH_SECRET environment variable is too short (minimum ${MIN_AUTH_SECRET_LENGTH} characters required). Application fails closed for session security.`
    );
  }
  return cleanSecret;
}

/**
 * Validates that an email string is normalized and matches standard email format.
 */
function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) {
    return false;
  }
  return EMAIL_REGEX.test(email);
}

/**
 * Creates a cryptographically signed session token using HMAC-SHA256.
 * Format: `<base64url(email|timestamp)>.<hmac_signature>`
 * Fails closed if AUTH_SECRET is not configured.
 */
export function createSessionToken(email: string): string {
  const cleanEmail = email.toLowerCase().trim();
  if (!isValidEmail(cleanEmail)) {
    throw new Error('Invalid email format for session token creation.');
  }

  const secret = getAuthSecret();
  const timestamp = Date.now().toString();
  const payload = `${cleanEmail}|${timestamp}`;
  const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url');

  const hmac = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('hex');

  return `${encodedPayload}.${hmac}`;
}

/**
 * Verifies a signed session token.
 * Validates:
 * 1. String structure and base64url encoding.
 * 2. Strict 64-character hex HMAC signature length.
 * 3. Timing-safe constant-time signature equality.
 * 4. Email format and normalization.
 * 5. Timestamp validity: rejects future-dated tokens (beyond 60s clock skew) and expired tokens (>30 days).
 * 6. Fails closed (returns null) if AUTH_SECRET is missing.
 */
export function verifySessionToken(token: string | null | undefined): string | null {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, receivedSignature] = parts;
  if (!encodedPayload || !receivedSignature) {
    return null;
  }

  // Strict signature format check (SHA-256 hex must be exactly 64 characters)
  if (!SIGNATURE_REGEX.test(receivedSignature)) {
    return null;
  }

  // Retrieve secret; fails closed if secret is not set
  let secret: string;
  try {
    secret = getAuthSecret();
  } catch {
    return null;
  }

  // Re-compute expected HMAC signature
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const receivedBuffer = Buffer.from(receivedSignature, 'hex');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return null;
  }

  // Timing-safe comparison against side-channel attacks
  if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return null;
  }

  // Decode and strictly validate payload
  try {
    const decoded = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const segments = decoded.split('|');

    if (segments.length !== 2) {
      return null;
    }

    const [email, timestampStr] = segments;
    if (!email || !timestampStr) {
      return null;
    }

    const cleanEmail = email.toLowerCase().trim();
    if (!isValidEmail(cleanEmail)) {
      return null;
    }

    const timestamp = Number(timestampStr);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      return null;
    }

    const now = Date.now();

    // Reject future-dated tokens beyond acceptable clock-skew allowance (60 seconds)
    if (timestamp > now + CLOCK_SKEW_ALLOWANCE_MS) {
      return null;
    }

    // Reject expired tokens (>30 days)
    if (now - timestamp > SESSION_MAX_AGE_MS) {
      return null;
    }

    return cleanEmail;
  } catch {
    return null;
  }
}

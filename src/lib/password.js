// src/lib/password.js
// Password hashing using PBKDF2-HMAC-SHA256 via the standard Web Crypto API.
// Cloudflare Workers does not support native Node modules like `bcrypt`,
// so we use PBKDF2, which is a well-vetted, standards-based KDF available
// natively in the Workers runtime.

const ITERATIONS = 100000;
const KEY_LENGTH_BITS = 256;
const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function deriveBits(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH_BITS
  );

  return new Uint8Array(derived);
}

/**
 * Hash a plaintext password. Returns a string of the form
 * `pbkdf2$<iterations>$<saltHex>$<hashHex>` which is safe to store in D1.
 */
export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hashBytes = await deriveBits(password, saltBytes);
  return `pbkdf2$${ITERATIONS}$${bytesToHex(saltBytes)}$${bytesToHex(hashBytes)}`;
}

/**
 * Verify a plaintext password against a stored hash created by hashPassword().
 */
export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const [, iterationsStr, saltHex, hashHex] = parts;
  const saltBytes = hexToBytes(saltHex);
  const expected = hexToBytes(hashHex);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: parseInt(iterationsStr, 10),
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH_BITS
  );

  const actual = new Uint8Array(derived);
  if (actual.length !== expected.length) return false;

  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

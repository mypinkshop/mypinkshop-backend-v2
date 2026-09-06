// src/lib/jwt.js
// Minimal, dependency-free JWT (HS256) implementation built on the
// standard Web Crypto API so it works natively on Cloudflare Workers.
// No Node.js `crypto`, `jsonwebtoken`, etc. are used anywhere.

const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlEncodeJSON(obj) {
  return bytesToBase64Url(encoder.encode(JSON.stringify(obj)));
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Sign a JWT (HS256).
 * @param {object} payload - claims to embed (exp is added automatically if expiresInSeconds is set)
 * @param {string} secret - HMAC secret (c.env.JWT_SECRET)
 * @param {number} expiresInSeconds - token lifetime, default 7 days
 */
export async function signJWT(payload, secret, expiresInSeconds = 60 * 60 * 24 * 7) {
  if (!secret) throw new Error('JWT secret is not configured');

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncodeJSON(header);
  const encodedPayload = base64UrlEncodeJSON(fullPayload);
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(unsignedToken));
  const encodedSignature = bytesToBase64Url(new Uint8Array(signature));

  return `${unsignedToken}.${encodedSignature}`;
}

/**
 * Verify a JWT (HS256). Returns the decoded payload, or throws on failure.
 * @param {string} token
 * @param {string} secret
 */
export async function verifyJWT(token, secret) {
  if (!secret) throw new Error('JWT secret is not configured');
  if (!token || typeof token !== 'string') throw new Error('Invalid token');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const key = await importHmacKey(secret);
  const signatureBytes = base64UrlToBytes(encodedSignature);

  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(unsignedToken));
  if (!valid) throw new Error('Invalid token signature');

  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload)));

  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error('Token has expired');
  }

  return payload;
}

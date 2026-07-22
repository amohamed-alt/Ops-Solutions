import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';

import { config } from './config.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

function getEncryptionKey() {
  const raw = config.encryptionKey.trim();

  if (!raw) {
    throw new Error('ENCRYPTION_KEY is required before storing OAuth tokens');
  }

  let key;

  if (/^[a-fA-F0-9]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }

  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  }

  return key;
}

export function encryptSecret(plainText) {
  if (typeof plainText !== 'string' || plainText.length === 0) {
    throw new TypeError('A non-empty secret is required');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url')
  ].join('.');
}

export function decryptSecret(payload) {
  if (typeof payload !== 'string') {
    throw new TypeError('Encrypted secret must be a string');
  }

  const [version, ivValue, authTagValue, encryptedValue] = payload.split('.');

  if (version !== VERSION || !ivValue || !authTagValue || !encryptedValue) {
    throw new Error('Encrypted secret has an unsupported format');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivValue, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashValue(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function secureStringEquals(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

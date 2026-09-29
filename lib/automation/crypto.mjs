import crypto from 'node:crypto';

function encryptionKey() {
  const raw = String(process.env.HANSORA_AUTOMATION_ENCRYPTION_KEY || '').trim();
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    try { key = Buffer.from(raw, 'base64'); } catch (_) { key = Buffer.alloc(0); }
  }
  if (key.length !== 32) {
    const error = new Error('automation_encryption_key_invalid');
    error.status = 503;
    throw error;
  }
  return key;
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return { encrypted_secret: encrypted.toString('base64'), secret_iv: iv.toString('base64'), secret_tag: cipher.getAuthTag().toString('base64') };
}

export function decryptSecret(record) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(record.secret_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.secret_tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(record.encrypted_secret, 'base64')), decipher.final()]).toString('utf8');
}

export function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
export function safeEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

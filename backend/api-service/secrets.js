/**
 * Encryption at rest for third-party credentials (GitHub backup tokens, Odoo API
 * keys). AES-256-GCM with a random 96-bit IV; the stored form is
 * `iv:authTag:ciphertext`, each part base64url. The key is the SHA-256 of a
 * caller-supplied secret, so each integration can use its own.
 */

import crypto from 'crypto';

function deriveKey(keyMaterial) {
    if (!keyMaterial) throw new Error('An encryption key is required.');
    return crypto.createHash('sha256').update(String(keyMaterial)).digest();
}

/**
 * @param {string} plaintext
 * @param {string} keyMaterial
 * @returns {string} `iv:authTag:ciphertext`
 */
export function encryptSecret(plaintext, keyMaterial) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(keyMaterial), iv);
    const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

/**
 * @param {string} stored `iv:authTag:ciphertext`
 * @param {string} keyMaterial
 * @returns {string}
 * @throws when the value is malformed, tampered with, or was encrypted with another key
 */
export function decryptSecret(stored, keyMaterial) {
    const [ivPart, tagPart, payloadPart] = String(stored || '').split(':');
    if (!ivPart || !tagPart || !payloadPart) {
        throw new Error('Stored secret is invalid');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(keyMaterial), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(payloadPart, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}

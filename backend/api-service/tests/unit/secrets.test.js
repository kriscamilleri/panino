import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { decryptSecret, encryptSecret } from '../../secrets.js';

const KEY = 'a-test-key-of-reasonable-length-123456';

describe('secrets', () => {
    it('round-trips, with a fresh IV each time', () => {
        const a = encryptSecret('odoo-api-key', KEY);
        const b = encryptSecret('odoo-api-key', KEY);
        expect(a).not.toBe(b);
        expect(a).not.toContain('odoo-api-key');
        expect(decryptSecret(a, KEY)).toBe('odoo-api-key');
        expect(decryptSecret(b, KEY)).toBe('odoo-api-key');
    });

    it('refuses another key, tampering and malformed values', () => {
        const stored = encryptSecret('secret', KEY);
        expect(() => decryptSecret(stored, 'another-key-of-reasonable-length-12345')).toThrow();
        const [iv, tag, payload] = stored.split(':');
        const flipped = Buffer.from(payload, 'base64url');
        flipped[0] ^= 1;
        expect(() => decryptSecret(`${iv}:${tag}:${flipped.toString('base64url')}`, KEY)).toThrow();
        expect(() => decryptSecret('not-a-secret', KEY)).toThrow('Stored secret is invalid');
        expect(() => encryptSecret('x', '')).toThrow();
    });

    it('reads values written by the format GitHub backup tokens were stored in', () => {
        // The pre-extraction backup.js code, inlined, so stored tokens keep decrypting.
        const key = crypto.createHash('sha256').update(KEY).digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update('gho_legacy', 'utf8'), cipher.final()]);
        const stored = `${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
        expect(decryptSecret(stored, KEY)).toBe('gho_legacy');
    });
});

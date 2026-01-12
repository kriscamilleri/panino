// Unit tests for sync.js utility functions
import { describe, it, expect } from 'vitest';
import { toBufferLike, toSiteIdBlob } from '../../sync.js';

describe('toBufferLike', () => {
    it('should convert Buffer to Buffer', () => {
        const buf = Buffer.from([1, 2, 3]);
        const result = toBufferLike(buf);
        expect(result).toEqual(buf);
        expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('should convert array to Buffer', () => {
        const result = toBufferLike([1, 2, 3]);
        expect(result).toEqual(Buffer.from([1, 2, 3]));
    });

    it('should convert hex string to Buffer', () => {
        const hex = '0102030405060708090a0b0c0d0e0f10';
        const result = toBufferLike(hex);
        expect(result).toEqual(Buffer.from(hex, 'hex'));
    });

    it('should convert UUID string to Buffer', () => {
        const uuid = '01020304-0506-0708-090a-0b0c0d0e0f10';
        const expected = Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex');
        const result = toBufferLike(uuid);
        expect(result).toEqual(expected);
    });

    it('should handle null', () => {
        const result = toBufferLike(null);
        expect(result).toBeNull();
    });

    it('should handle undefined', () => {
        const result = toBufferLike(undefined);
        expect(result).toBeNull();
    });

    it('should convert object with numeric keys to Buffer', () => {
        const obj = { 0: 1, 1: 2, 2: 3 };
        const result = toBufferLike(obj);
        expect(result).toEqual(Buffer.from([1, 2, 3]));
    });

    it('should convert plain string to Buffer (base64 or UTF-8)', () => {
        const result = toBufferLike('hello');
        // The function tries base64 first, then falls back to UTF-8
        expect(Buffer.isBuffer(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
    });

    it('should handle 32-character hex strings', () => {
        const hex32 = 'a'.repeat(32);
        const result = toBufferLike(hex32);
        expect(result.length).toBe(16);
        expect(result).toEqual(Buffer.from(hex32, 'hex'));
    });
});

describe('toSiteIdBlob', () => {
    it('should extract 16-byte site ID from buffer', () => {
        const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
        const result = toSiteIdBlob(buf);
        expect(result.length).toBe(16);
        expect(result).toEqual(buf.subarray(0, 16));
    });

    it('should return full buffer if exactly 16 bytes', () => {
        const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        const result = toSiteIdBlob(buf);
        expect(result.length).toBe(16);
        expect(result).toEqual(buf);
    });

    it('should handle hex string input', () => {
        const hex = 'a'.repeat(32); // 16-byte hex string
        const result = toSiteIdBlob(hex);
        expect(result.length).toBe(16);
        expect(result).toEqual(Buffer.from(hex, 'hex'));
    });

    it('should handle UUID string input', () => {
        const uuid = '01020304-0506-0708-090a-0b0c0d0e0f10';
        const result = toSiteIdBlob(uuid);
        expect(result.length).toBe(16);
        expect(result).toEqual(Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex'));
    });

    it('should return null for null input', () => {
        const result = toSiteIdBlob(null);
        expect(result).toBeNull();
    });

    it('should truncate longer buffers to 16 bytes', () => {
        const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
        const result = toSiteIdBlob(buf);
        expect(result.length).toBe(16);
        expect(result).toEqual(buf.subarray(0, 16));
    });
});

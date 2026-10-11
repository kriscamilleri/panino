// Unit tests for sync.js utility functions
import { describe, it, expect } from 'vitest';
import { isValidPackedPrimaryKey, toBufferLike, toSiteIdBlob } from '../../sync.js';

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

describe('isValidPackedPrimaryKey', () => {
  const textKey = (text) => {
    const bytes = Buffer.from(text, 'utf8');
    return Buffer.concat([Buffer.from([1, (1 << 3) | 3, bytes.length]), bytes]);
  };

  it('accepts a single text column, the shape every Panino table uses', () => {
    expect(isValidPackedPrimaryKey(textKey('33333333-3333-4333-8333-333333333333'))).toBe(true);
    expect(isValidPackedPrimaryKey(textKey('note-1'))).toBe(true);
  });

  it('accepts the other column types CR-SQLite can pack', () => {
    expect(isValidPackedPrimaryKey(Buffer.from([1, (1 << 3) | 1, 7]))).toBe(true); // integer 7
    expect(isValidPackedPrimaryKey(Buffer.from([1, 5]))).toBe(true); // null
    expect(isValidPackedPrimaryKey(Buffer.from([1, 2, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true); // float
    expect(isValidPackedPrimaryKey(Buffer.from([2, (1 << 3) | 3, 1, 0x61, (1 << 3) | 4, 2, 0, 1]))).toBe(true); // text + blob
  });

  it('rejects values that are not packed keys at all', () => {
    expect(isValidPackedPrimaryKey(null)).toBe(false);
    expect(isValidPackedPrimaryKey('note-1')).toBe(false);
    expect(isValidPackedPrimaryKey(Buffer.alloc(0))).toBe(false);
    expect(isValidPackedPrimaryKey(Buffer.from([0]))).toBe(false);
    expect(isValidPackedPrimaryKey(Buffer.from('note-1', 'utf8'))).toBe(false);
  });

  it('rejects truncated, overlong and unknown-type payloads', () => {
    const valid = textKey('note-1');
    expect(isValidPackedPrimaryKey(valid.subarray(0, valid.length - 1))).toBe(false);
    expect(isValidPackedPrimaryKey(Buffer.concat([valid, Buffer.from([0])]))).toBe(false);
    expect(isValidPackedPrimaryKey(Buffer.from([1, (1 << 3) | 3, 200, 0x61]))).toBe(false); // length past the end
    expect(isValidPackedPrimaryKey(Buffer.from([1, (9 << 3) | 1, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(false); // 9-byte integer
    expect(isValidPackedPrimaryKey(Buffer.from([1, 6]))).toBe(false); // no such type
    expect(isValidPackedPrimaryKey(Buffer.from([2, (1 << 3) | 3, 1, 0x61]))).toBe(false); // second column missing
  });

  it('rejects the bytes a hex key string decodes to when read as base64', () => {
    // A client that sends hex(pk) used to reach the extension as garbage and abort the process.
    const hex = textKey('33333333-3333-4333-8333-333333333333').toString('hex').toUpperCase();
    expect(isValidPackedPrimaryKey(Buffer.from(hex, 'base64'))).toBe(false);
  });
});

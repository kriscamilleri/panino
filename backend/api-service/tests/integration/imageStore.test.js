// storeImage, the storing step the upload route and the AI agents add-on share (image.js).
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { afterEach, describe, expect, it } from 'vitest';
import { getHealthyDb, getUserDb } from '../../db.js';
import { databaseImageTarget, ImageStoreError, MAX_IMAGE_SIZE_BYTES, storeImage } from '../../image.js';
import { deleteSpaceUploads, resolveDatabaseUploadRoot, resolveSpaceUploadRoot } from '../../spaceStorage.js';
import { cleanupTestUser, setupTestUser } from '../testHelpers.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('storeImage', () => {
    const cleanups = [];
    afterEach(() => {
        while (cleanups.length) cleanups.pop()();
    });

    async function personalTarget() {
        const user = await setupTestUser(`store-${Date.now()}-${Math.random()}@example.com`, 'password123');
        const dbKey = `user:${user.userId}`;
        cleanups.push(() => {
            const root = resolveDatabaseUploadRoot(dbKey);
            for (const row of getUserDb(user.userId).prepare('SELECT path FROM images').all()) {
                const file = path.join(root, row.path);
                if (fs.existsSync(file)) fs.unlinkSync(file);
            }
            cleanupTestUser(user.userId);
        });
        return databaseImageTarget(dbKey, getHealthyDb(dbKey, 'test'), user.userId);
    }

    it('writes the file under a UUID name in the upload root and records the row', async () => {
        const target = await personalTarget();
        const stored = storeImage(target, { buffer: PNG, originalName: 'Grüße.png', mimeType: 'image/png' });
        expect(stored).toMatchObject({
            filename: 'Grüße.png', mimeType: 'image/png', sizeBytes: PNG.length,
            sha256: crypto.createHash('sha256').update(PNG).digest('hex'), url: `/images/${stored.id}`,
        });
        const row = target.db.prepare('SELECT * FROM images WHERE id = ?').get(stored.id);
        expect(row).toMatchObject({ user_id: target.userId, filename: 'Grüße.png', size_bytes: PNG.length, created_at: stored.createdAt });
        expect(row.path).toMatch(/^[0-9a-f-]{36}\.png$/);
        expect(fs.readFileSync(path.join(resolveDatabaseUploadRoot(target.dbKey), row.path)).equals(PNG)).toBe(true);
    });

    it('refuses with closed codes before writing anything', async () => {
        const target = await personalTarget();
        const refusals = [
            [{ buffer: PNG, originalName: 'a.txt', mimeType: 'text/plain' }, 'IMAGE_TYPE_NOT_ALLOWED'],
            [{ buffer: PNG, originalName: 'a.jpg', mimeType: 'image/png' }, 'IMAGE_EXTENSION_MISMATCH'],
            [{ buffer: Buffer.alloc(MAX_IMAGE_SIZE_BYTES + 1), originalName: 'a.png', mimeType: 'image/png' }, 'IMAGE_TOO_LARGE'],
        ];
        for (const [image, code] of refusals) {
            let error;
            try {
                storeImage(target, image);
            } catch (caught) {
                error = caught;
            }
            expect(error).toBeInstanceOf(ImageStoreError);
            expect(error.code).toBe(code);
        }
        expect(target.db.prepare('SELECT COUNT(*) AS n FROM images').get().n).toBe(0);
    });

    it('enforces the quota', async () => {
        const target = await personalTarget();
        expect(() => storeImage({ ...target, quotaBytes: PNG.length - 1 }, { buffer: PNG, originalName: 'a.png', mimeType: 'image/png' }))
            .toThrow(expect.objectContaining({ code: 'IMAGE_QUOTA_EXCEEDED' }));
        expect(target.db.prepare('SELECT COUNT(*) AS n FROM images').get().n).toBe(0);
    });

    it('removes the written file when the row cannot be recorded', async () => {
        const spaceId = uuidv4();
        cleanups.push(() => deleteSpaceUploads(spaceId));
        const failingDb = {
            prepare: (sql) => (sql.includes('INSERT')
                ? { run: () => { throw new Error('disk I/O error'); } }
                : { get: () => ({ image_count: 0, total_image_bytes: 0 }) }),
        };
        const target = databaseImageTarget(`space:${spaceId}`, failingDb, uuidv4());
        expect(() => storeImage(target, { buffer: PNG, originalName: 'a.png', mimeType: 'image/png' })).toThrow('disk I/O error');
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(fs.readdirSync(resolveSpaceUploadRoot(spaceId))).toEqual([]);
    });
});

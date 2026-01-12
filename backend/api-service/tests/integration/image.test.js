// Integration tests for image upload endpoints
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTestApp, setupTestUser, cleanupTestUser, getTestToken } from '../testHelpers.js';
import { getUserDb } from '../../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const FIXTURES_DIR = path.join(__dirname, '../fixtures');

describe('POST /images', () => {
    let app, server;
    let testUser;
    let testImagePath;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;

        // Ensure fixtures directory exists and create a test image
        if (!fs.existsSync(FIXTURES_DIR)) {
            fs.mkdirSync(FIXTURES_DIR, { recursive: true });
        }

        testImagePath = path.join(FIXTURES_DIR, 'test-image.png');
        // Create a minimal valid PNG file (1x1 pixel transparent)
        const pngBuffer = Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
            0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
            0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
            0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
        ]);
        fs.writeFileSync(testImagePath, pngBuffer);
    });

    beforeEach(async () => {
        testUser = await setupTestUser('image-test@example.com', 'password123');
    });

    afterEach(() => {
        if (testUser) {
            cleanupTestUser(testUser.userId);
        }
    });

    afterAll(() => {
        // Clean up test fixtures
        if (fs.existsSync(testImagePath)) {
            fs.unlinkSync(testImagePath);
        }

        return new Promise((resolve) => {
            if (server) {
                server.close(() => resolve());
            } else {
                resolve();
            }
        });
    });

    it('should upload an image successfully for an authenticated user', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/images')
            .set('Authorization', `Bearer ${token}`)
            .attach('image', testImagePath);

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('id');
        expect(response.body).toHaveProperty('url');
        expect(response.body.url).toContain('/images/');
    });

    it('should store the image file in the uploads directory', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/images')
            .set('Authorization', `Bearer ${token}`)
            .attach('image', testImagePath);

        expect(response.status).toBe(201);

        // Get the image record to find the file path
        const db = getUserDb(testUser.userId);
        const image = db.prepare('SELECT path FROM images WHERE id = ?').get(response.body.id);

        const uploadedFilePath = path.join(UPLOADS_DIR, image.path);
        expect(fs.existsSync(uploadedFilePath)).toBe(true);

        // Clean up
        fs.unlinkSync(uploadedFilePath);
    });

    it('should create a corresponding record in the user database', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/images')
            .set('Authorization', `Bearer ${token}`)
            .attach('image', testImagePath);

        expect(response.status).toBe(201);

        const db = getUserDb(testUser.userId);
        const image = db.prepare('SELECT * FROM images WHERE id = ?').get(response.body.id);

        expect(image).toBeDefined();
        expect(image.user_id).toBe(testUser.userId);
        expect(image.filename).toBe('test-image.png');
        expect(image.mime_type).toBe('image/png');
        expect(image.path).toBeDefined();

        // Clean up
        const uploadedFilePath = path.join(UPLOADS_DIR, image.path);
        if (fs.existsSync(uploadedFilePath)) {
            fs.unlinkSync(uploadedFilePath);
        }
    });

    it('should reject with 401 for unauthenticated requests', async () => {
        const response = await request(app)
            .post('/images')
            .attach('image', testImagePath);

        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error');
    });

    it('should reject with 400 if no image file is provided', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/images')
            .set('Authorization', `Bearer ${token}`)
            .send({});

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
    });

    it('should reject files exceeding the size limit', async () => {
        const token = getTestToken(testUser.userId);

        // Create a large file (>10MB)
        const largeFilePath = path.join(FIXTURES_DIR, 'large-image.png');
        const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
        fs.writeFileSync(largeFilePath, largeBuffer);

        const response = await request(app)
            .post('/images')
            .set('Authorization', `Bearer ${token}`)
            .attach('image', largeFilePath);

        expect(response.status).toBe(413); // Payload Too Large

        // Clean up
        fs.unlinkSync(largeFilePath);
    });
});

describe('GET /images/:id', () => {
    let app, server;
    let testUser, otherUser;
    let testImagePath;
    let uploadedImageId;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;

        // Ensure fixtures directory exists and create a test image
        if (!fs.existsSync(FIXTURES_DIR)) {
            fs.mkdirSync(FIXTURES_DIR, { recursive: true });
        }

        testImagePath = path.join(FIXTURES_DIR, 'test-image.png');
        const pngBuffer = Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
            0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
            0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
            0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
        ]);
        fs.writeFileSync(testImagePath, pngBuffer);
    });

    beforeEach(async () => {
        testUser = await setupTestUser('image-get-test@example.com', 'password123');
        otherUser = await setupTestUser('other-user@example.com', 'password123');

        // Upload an image as testUser
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/images')
            .set('Authorization', `Bearer ${token}`)
            .attach('image', testImagePath);

        uploadedImageId = response.body.id;
    });

    afterEach(() => {
        if (testUser) {
            // Clean up uploaded files
            const db = getUserDb(testUser.userId);
            const images = db.prepare('SELECT path FROM images').all();
            images.forEach(img => {
                const filePath = path.join(UPLOADS_DIR, img.path);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            });
            cleanupTestUser(testUser.userId);
        }
        if (otherUser) {
            cleanupTestUser(otherUser.userId);
        }
    });

    afterAll(() => {
        // Clean up test fixtures
        if (fs.existsSync(testImagePath)) {
            fs.unlinkSync(testImagePath);
        }

        return new Promise((resolve) => {
            if (server) {
                server.close(() => resolve());
            } else {
                resolve();
            }
        });
    });

    it('should return an image for the authenticated owner', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .get(`/images/${uploadedImageId}`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('image/png');
    });

    it('should return the correct Content-Type header', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .get(`/images/${uploadedImageId}`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('image/png');
    });

    it('should reject with 404 if a different user tries to access the image', async () => {
        const otherToken = getTestToken(otherUser.userId);
        const response = await request(app)
            .get(`/images/${uploadedImageId}`)
            .set('Authorization', `Bearer ${otherToken}`);

        expect(response.status).toBe(404);
        expect(response.body).toHaveProperty('error');
    });

    it('should reject with 404 for a non-existent image ID', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .get('/images/non-existent-id')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(404);
        expect(response.body).toHaveProperty('error');
    });

    it('should return 404 if the file is in the DB but missing from the disk', async () => {
        const token = getTestToken(testUser.userId);

        // Delete the file from disk but keep the DB record
        const db = getUserDb(testUser.userId);
        const image = db.prepare('SELECT path FROM images WHERE id = ?').get(uploadedImageId);
        const filePath = path.join(UPLOADS_DIR, image.path);
        fs.unlinkSync(filePath);

        const response = await request(app)
            .get(`/images/${uploadedImageId}`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(404);
        expect(response.body).toHaveProperty('error');
    });

    it('should reject with 403 for a path traversal attempt', async () => {
        const token = getTestToken(testUser.userId);

        // Manually insert a malicious path into the database
        const db = getUserDb(testUser.userId);
        const maliciousId = 'malicious-id';
        db.prepare(`
            INSERT INTO images (id, user_id, filename, mime_type, path, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(maliciousId, testUser.userId, 'package.json', 'application/json', '../../package.json', new Date().toISOString());

        const response = await request(app)
            .get(`/images/${maliciousId}`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty('error');
    });
});

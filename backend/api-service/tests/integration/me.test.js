// Integration tests for /me endpoints
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp, setupTestUser, cleanupTestUser, getTestToken } from '../testHelpers.js';

describe('GET /me', () => {
    let app, server;
    let testUser;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;
    });

    beforeEach(async () => {
        testUser = await setupTestUser('me-test@example.com', 'password123');
    });

    afterEach(() => {
        if (testUser) {
            cleanupTestUser(testUser.userId);
        }
    });

    afterAll(() => {
        return new Promise((resolve) => {
            if (server) {
                server.close(() => resolve());
            } else {
                resolve();
            }
        });
    });

    it('should return the current user profile for an authenticated request', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .get('/me')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('id', testUser.userId);
        expect(response.body).toHaveProperty('email', testUser.email);
        expect(response.body).toHaveProperty('name');
    });

    it('should not return the password hash', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .get('/me')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('password_hash');
    });

    it('should return 401 for an unauthenticated request', async () => {
        const response = await request(app)
            .get('/me');

        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error');
    });
});

describe('POST /me/password', () => {
    let app, server;
    let testUser;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;
    });

    beforeEach(async () => {
        testUser = await setupTestUser('password-test@example.com', 'password123');
    });

    afterEach(() => {
        if (testUser) {
            cleanupTestUser(testUser.userId);
        }
    });

    afterAll(() => {
        return new Promise((resolve) => {
            if (server) {
                server.close(() => resolve());
            } else {
                resolve();
            }
        });
    });

    it('should update the password successfully with correct current password', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/me/password')
            .set('Authorization', `Bearer ${token}`)
            .send({
                currentPassword: 'password123',
                newPassword: 'newpassword456'
            });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('message');
    });

    it('should allow login with the new password after update', async () => {
        const token = getTestToken(testUser.userId);

        // Update password
        await request(app)
            .post('/me/password')
            .set('Authorization', `Bearer ${token}`)
            .send({
                currentPassword: 'password123',
                newPassword: 'newpassword456'
            });

        // Try logging in with old password (should fail)
        const oldPasswordResponse = await request(app)
            .post('/login')
            .send({
                email: testUser.email,
                password: 'password123'
            });
        expect(oldPasswordResponse.status).toBe(401);

        // Try logging in with new password (should succeed)
        const newPasswordResponse = await request(app)
            .post('/login')
            .send({
                email: testUser.email,
                password: 'newpassword456'
            });
        expect(newPasswordResponse.status).toBe(200);
        expect(newPasswordResponse.body).toHaveProperty('token');
    });

    it('should reject with 401 for an incorrect current password', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/me/password')
            .set('Authorization', `Bearer ${token}`)
            .send({
                currentPassword: 'wrongpassword',
                newPassword: 'newpassword456'
            });

        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error');
    });

    it('should reject with 400 if the new password is too short', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/me/password')
            .set('Authorization', `Bearer ${token}`)
            .send({
                currentPassword: 'password123',
                newPassword: 'short'
            });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
    });

    it('should reject with 400 for missing fields', async () => {
        const token = getTestToken(testUser.userId);

        // Missing newPassword
        const response1 = await request(app)
            .post('/me/password')
            .set('Authorization', `Bearer ${token}`)
            .send({
                currentPassword: 'password123'
            });
        expect(response1.status).toBe(400);

        // Missing currentPassword
        const response2 = await request(app)
            .post('/me/password')
            .set('Authorization', `Bearer ${token}`)
            .send({
                newPassword: 'newpassword456'
            });
        expect(response2.status).toBe(400);
    });

    it('should reject with 401 for an unauthenticated request', async () => {
        const response = await request(app)
            .post('/me/password')
            .send({
                currentPassword: 'password123',
                newPassword: 'newpassword456'
            });

        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error');
    });
});

describe('POST /refresh', () => {
    let app, server;
    let testUser;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;
    });

    beforeEach(async () => {
        testUser = await setupTestUser('refresh-test@example.com', 'password123');
    });

    afterEach(() => {
        if (testUser) {
            cleanupTestUser(testUser.userId);
        }
    });

    afterAll(() => {
        return new Promise((resolve) => {
            if (server) {
                server.close(() => resolve());
            } else {
                resolve();
            }
        });
    });

    it('should issue a new token for an authenticated user', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/refresh')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('token');
        expect(typeof response.body.token).toBe('string');
        expect(response.body.token).not.toBe(token); // Should be a new token
    });

    it('should reject with 401 for an unauthenticated request', async () => {
        const response = await request(app)
            .post('/refresh');

        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error');
    });

    it('should reject with 403 for an invalid or expired token', async () => {
        const response = await request(app)
            .post('/refresh')
            .set('Authorization', 'Bearer invalid.token.here');

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty('error');
    });
});

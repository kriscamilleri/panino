// Integration tests for authentication endpoints
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp, setupTestUser, cleanupTestUser } from '../testHelpers.js';
import { getAuthDb } from '../../db.js';

describe('POST /login', () => {
    let app, server;
    let testUser;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;
    });

    beforeEach(async () => {
        testUser = await setupTestUser('login-test@example.com', 'password123');
    });

    afterEach(() => {
        if (testUser) {
            cleanupTestUser(testUser.userId);
        }
    });

    afterAll((done) => {
        if (server) {
            server.close(done);
        } else {
            done();
        }
    });

    it('should login with valid credentials', async () => {
        const response = await request(app)
            .post('/login')
            .send({ 
                email: testUser.email, 
                password: testUser.password 
            });
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('token');
        expect(response.body).toHaveProperty('user');
        expect(response.body.user.email).toBe(testUser.email);
        expect(typeof response.body.token).toBe('string');
    });

    it('should reject invalid password', async () => {
        const response = await request(app)
            .post('/login')
            .send({ 
                email: testUser.email, 
                password: 'wrongpassword' 
            });
        
        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error');
    });

    it('should reject non-existent user', async () => {
        const response = await request(app)
            .post('/login')
            .send({ 
                email: 'nonexistent@example.com', 
                password: 'password123' 
            });
        
        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error');
    });

    it('should require email', async () => {
        const response = await request(app)
            .post('/login')
            .send({ 
                password: 'password123' 
            });
        
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
    });

    it('should require password', async () => {
        const response = await request(app)
            .post('/login')
            .send({ 
                email: testUser.email 
            });
        
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
    });

    it('should reject empty credentials', async () => {
        const response = await request(app)
            .post('/login')
            .send({});
        
        expect(response.status).toBe(400);
    });

    it('should return user information without password hash', async () => {
        const response = await request(app)
            .post('/login')
            .send({ 
                email: testUser.email, 
                password: testUser.password 
            });
        
        expect(response.status).toBe(200);
        expect(response.body.user).not.toHaveProperty('password_hash');
        expect(response.body.user).not.toHaveProperty('password');
    });
});

describe('POST /signup', () => {
    let app, server;
    const testEmail = `signup-test-${Date.now()}@example.com`;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;
    });

    afterEach(() => {
        // Cleanup any created user
        const db = getAuthDb();
        try {
            db.prepare('DELETE FROM users WHERE email = ?').run(testEmail);
        } catch (e) {
            // Ignore if user doesn't exist
        }
    });

    afterAll((done) => {
        if (server) {
            server.close(done);
        } else {
            done();
        }
    });

    it('should create new user with valid data', async () => {
        const response = await request(app)
            .post('/signup')
            .send({
                name: 'New User',
                email: testEmail,
                password: 'password123'
            });
        
        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('token');
        expect(response.body).toHaveProperty('user');
        expect(response.body.user.email).toBe(testEmail);
        expect(response.body.user.name).toBe('New User');
    });

    it('should reject duplicate email', async () => {
        // First signup
        await request(app)
            .post('/signup')
            .send({
                name: 'First User',
                email: testEmail,
                password: 'password123'
            });
        
        // Try to signup again with same email
        const response = await request(app)
            .post('/signup')
            .send({
                name: 'Second User',
                email: testEmail,
                password: 'password456'
            });
        
        expect(response.status).toBe(409); // 409 Conflict is correct for duplicate resource
        expect(response.body).toHaveProperty('error');
    });

    it('should require name', async () => {
        const response = await request(app)
            .post('/signup')
            .send({
                email: testEmail,
                password: 'password123'
            });
        
        expect(response.status).toBe(400);
    });

    it('should require email', async () => {
        const response = await request(app)
            .post('/signup')
            .send({
                name: 'Test User',
                password: 'password123'
            });
        
        expect(response.status).toBe(400);
    });

    it('should require password', async () => {
        const response = await request(app)
            .post('/signup')
            .send({
                name: 'Test User',
                email: testEmail
            });
        
        expect(response.status).toBe(400);
    });

    it('should accept any string as email (no format validation)', async () => {
        // Note: The backend doesn't validate email format, it accepts any string
        // This is a design decision - frontend can validate format if needed
        const uniqueEmail = `invalid-email-${Date.now()}`; // Make it unique to avoid conflicts
        const response = await request(app)
            .post('/signup')
            .send({
                name: 'Test User',
                email: uniqueEmail,
                password: 'password123'
            });
        
        expect(response.status).toBe(201); // It succeeds
        expect(response.body).toHaveProperty('token');
        
        // Cleanup
        if (response.body.user) {
            cleanupTestUser(response.body.user.id);
        }
    });

    it('should hash password before storing', async () => {
        const password = 'mySecretPassword123';
        
        const response = await request(app)
            .post('/signup')
            .send({
                name: 'Security Test User',
                email: testEmail,
                password: password
            });
        
        expect(response.status).toBe(201);
        
        // Check that password is hashed in database
        const db = getAuthDb();
        const user = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(testEmail);
        
        expect(user.password_hash).toBeDefined();
        expect(user.password_hash).not.toBe(password);
        expect(user.password_hash.startsWith('$2a$')).toBe(true); // bcrypt hash prefix
    });
});

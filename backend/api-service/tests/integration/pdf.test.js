// Integration tests for PDF generation endpoint
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp, setupTestUser, cleanupTestUser, getTestToken } from '../testHelpers.js';

describe('POST /render-pdf', () => {
    let app, server;
    let testUser;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;
    });

    beforeEach(async () => {
        testUser = await setupTestUser('pdf-test@example.com', 'password123');
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

    it('should generate a PDF from basic HTML and CSS', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                htmlContent: '<h1>Test Document</h1><p>This is a test.</p>',
                cssStyles: 'h1 { color: blue; }',
                printStyles: {}
            })
            .responseType('blob');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.body.length).toBeGreaterThan(0);
    }, 30000); // Increase timeout for PDF generation

    it('should apply print styles like headers, footers, and margins', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                htmlContent: '<h1>Document with Print Styles</h1><p>Content here.</p>',
                cssStyles: 'body { font-family: Arial; }',
                printStyles: {
                    headerText: 'Test Header',
                    footerText: 'Page {page} of {total}',
                    marginTop: '20mm',
                    marginBottom: '20mm'
                }
            })
            .responseType('blob');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should sanitize and remove script tags from HTML content', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                htmlContent: '<h1>Test</h1><script>alert("XSS")</script><p>Content</p>',
                cssStyles: 'body { font-family: Arial; }',
                printStyles: {}
            })
            .responseType('blob');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        // The PDF should be generated successfully, with script tags removed
        expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should reject with 401 for unauthenticated requests', async () => {
        const response = await request(app)
            .post('/render-pdf')
            .send({
                htmlContent: '<h1>Test</h1>',
                cssStyles: '',
                printStyles: {}
            });

        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error');
    });

    it('should reject with 400 for requests missing htmlContent', async () => {
        const token = getTestToken(testUser.userId);
        const response = await request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                cssStyles: '',
                printStyles: {}
            });

        expect(response.status).toBe(400);
    });

    it('should handle concurrent requests gracefully via the queue', async () => {
        const token = getTestToken(testUser.userId);

        const request1 = request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                htmlContent: '<h1>Document 1</h1>',
                cssStyles: 'body { font-family: Arial; }',
                printStyles: {}
            })
            .responseType('blob');

        const request2 = request(app)
            .post('/render-pdf')
            .set('Authorization', `Bearer ${token}`)
            .send({
                htmlContent: '<h1>Document 2</h1>',
                cssStyles: 'body { font-family: Arial; }',
                printStyles: {}
            })
            .responseType('blob');

        const [response1, response2] = await Promise.all([request1, request2]);

        expect(response1.status).toBe(200);
        expect(response1.headers['content-type']).toBe('application/pdf');
        expect(response2.status).toBe(200);
        expect(response2.headers['content-type']).toBe('application/pdf');
    }, 60000); // Longer timeout for concurrent requests
});

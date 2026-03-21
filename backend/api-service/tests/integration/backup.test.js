import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createTestApp, cleanupTestUser, setupTestUser } from '../testHelpers.js';
import { __resetBackupStateForTests } from '../../backup.js';
import { getUserDb } from '../../db.js';

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function connectGithubBackup(app, token) {
    const connectResponse = await request(app)
        .post('/backup/github/connect')
        .set('Authorization', `Bearer ${token}`)
        .send({});

    expect(connectResponse.status).toBe(200);
    const authorizeUrl = new URL(connectResponse.body.authorizeUrl);
    const state = authorizeUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callbackResponse = await request(app)
        .get('/backup/github/callback')
        .query({ code: 'oauth-code', state });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toContain('#/?githubBackup=connected');
}

async function waitForStatus(app, token, predicate, attempts = 20) {
    for (let index = 0; index < attempts; index += 1) {
        const response = await request(app)
            .get('/backup/github/status')
            .set('Authorization', `Bearer ${token}`);

        if (predicate(response.body)) {
            return response.body;
        }

        await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error('Condition not met before timeout');
}

describe('GitHub backup routes', () => {
    let app;
    let server;
    let testUser;

    beforeAll(() => {
        const result = createTestApp();
        app = result.app;
        server = result.server;
    });

    beforeEach(async () => {
        process.env.GITHUB_CLIENT_ID = 'github-client-id';
        process.env.GITHUB_CLIENT_SECRET = 'github-client-secret';
        __resetBackupStateForTests();
        vi.restoreAllMocks();
        testUser = await setupTestUser(`backup-${Date.now()}@example.com`, 'password123');
    });

    afterEach(() => {
        if (testUser) {
            cleanupTestUser(testUser.userId);
        }
        delete process.env.GITHUB_CLIENT_ID;
        delete process.env.GITHUB_CLIENT_SECRET;
        __resetBackupStateForTests();
        vi.restoreAllMocks();
    });

    afterAll(() => new Promise((resolve) => server.close(resolve)));

    it('returns default disconnected status before OAuth is connected', async () => {
        const response = await request(app)
            .get('/backup/github/status')
            .set('Authorization', `Bearer ${testUser ? '' : ''}`);

        expect(response.status).toBe(401);

        const token = (await import('../testHelpers.js')).getTestToken(testUser.userId);
        const authedResponse = await request(app)
            .get('/backup/github/status')
            .set('Authorization', `Bearer ${token}`);

        expect(authedResponse.status).toBe(200);
        expect(authedResponse.body.connected).toBe(false);
        expect(authedResponse.body.oauthConfigured).toBe(true);
        expect(authedResponse.body.repoFullName).toBeNull();
    });

    it('connects GitHub, lists pushable repositories, creates a repo, and records a backup run', async () => {
        const { getTestToken } = await import('../testHelpers.js');
        const token = getTestToken(testUser.userId);
        const db = getUserDb(testUser.userId);
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('note-1', testUser.userId, null, 'Roadmap', '# Roadmap\n\nShip it.', now, now);

        db.prepare(`
            INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            'missing-unused-image',
            testUser.userId,
            'unused.png',
            'image/png',
            'missing-unused-image.png',
            10,
            'deadbeef',
            now,
        );

        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
            const target = String(url);
            const method = (options.method || 'GET').toUpperCase();

            if (target.includes('/login/oauth/access_token')) {
                return jsonResponse({ access_token: 'gho_test_token' });
            }
            if (target.endsWith('/user')) {
                return jsonResponse({ login: 'octocat', avatar_url: 'https://avatars.example/octocat.png' });
            }
            if (target.includes('/user/repos?')) {
                return jsonResponse([
                    {
                        id: 1,
                        name: 'panino-backup',
                        full_name: 'octocat/panino-backup',
                        private: true,
                        html_url: 'https://github.com/octocat/panino-backup',
                        default_branch: 'main',
                        permissions: { push: true },
                    },
                    {
                        id: 2,
                        name: 'read-only',
                        full_name: 'octocat/read-only',
                        private: true,
                        html_url: 'https://github.com/octocat/read-only',
                        default_branch: 'main',
                        permissions: { push: false },
                    },
                ]);
            }
            if (target.endsWith('/user/repos') && method === 'POST') {
                return jsonResponse({
                    id: 3,
                    name: 'panino-backup',
                    full_name: 'octocat/panino-backup',
                    private: true,
                    html_url: 'https://github.com/octocat/panino-backup',
                    default_branch: 'main',
                }, 201);
            }
            if (target.includes('/repos/octocat/panino-backup/git/ref/heads/main')) {
                return jsonResponse({ object: { sha: 'head-sha' } });
            }
            if (target.includes('/repos/octocat/panino-backup/git/trees')) {
                return jsonResponse({ sha: 'tree-sha' }, 201);
            }
            if (target.includes('/repos/octocat/panino-backup/git/commits')) {
                return jsonResponse({ sha: 'commit-sha' }, 201);
            }
            if (target.includes('/repos/octocat/panino-backup/git/refs/heads/main')) {
                return jsonResponse({ ref: 'refs/heads/main' });
            }

            throw new Error(`Unexpected fetch request: ${method} ${target}`);
        });

        await connectGithubBackup(app, token);

        const reposResponse = await request(app)
            .get('/backup/github/repos')
            .set('Authorization', `Bearer ${token}`);

        expect(reposResponse.status).toBe(200);
        expect(reposResponse.body.repos).toEqual([
            expect.objectContaining({ fullName: 'octocat/panino-backup' }),
        ]);

        const createRepoResponse = await request(app)
            .post('/backup/github/repos')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'panino-backup' });

        expect(createRepoResponse.status).toBe(201);
        expect(createRepoResponse.body.repo.fullName).toBe('octocat/panino-backup');

        const runResponse = await request(app)
            .post('/backup/github/run')
            .set('Authorization', `Bearer ${token}`)
            .send({});

        expect(runResponse.status).toBe(202);

        const status = await waitForStatus(app, token, (payload) => payload.lastBackupSha === 'commit-sha');
        expect(status.connected).toBe(true);
        expect(status.username).toBe('octocat');
        expect(status.repoFullName).toBe('octocat/panino-backup');
        expect(status.lastBackupSha).toBe('commit-sha');
        expect(status.lastBackupAt).toBeTruthy();
        expect(db.prepare('SELECT id FROM images WHERE id = ?').get('missing-unused-image')).toBeUndefined();
        const refUpdateCall = fetchMock.mock.calls.find(([url, options]) => {
            return String(url).includes('/repos/octocat/panino-backup/git/refs/heads/main')
                && String(options?.method || 'GET').toUpperCase() === 'PATCH';
        });
        expect(refUpdateCall).toBeTruthy();
        expect(JSON.parse(refUpdateCall[1].body)).toEqual({ sha: 'commit-sha', force: false });
        expect(fetchMock).toHaveBeenCalled();
    });

    it('completes backup while warning about referenced missing images', async () => {
        const { getTestToken } = await import('../testHelpers.js');
        const token = getTestToken(testUser.userId);
        const db = getUserDb(testUser.userId);
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            'note-missing-image',
            testUser.userId,
            null,
            'PDF Test',
            '![Missing](/images/missing-referenced-image)',
            now,
            now,
        );

        db.prepare(`
            INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            'missing-referenced-image',
            testUser.userId,
            'image.png',
            'image/png',
            'missing-referenced-image.png',
            10,
            'deadbeef',
            now,
        );

        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
            const target = String(url);
            const method = (options.method || 'GET').toUpperCase();

            if (target.includes('/login/oauth/access_token')) {
                return jsonResponse({ access_token: 'gho_test_token' });
            }
            if (target.endsWith('/user')) {
                return jsonResponse({ login: 'octocat', avatar_url: 'https://avatars.example/octocat.png' });
            }
            if (target.includes('/repos/octocat/panino-backup/git/ref/heads/main') && method === 'GET') {
                return jsonResponse({ object: { sha: 'head-sha' } });
            }
            if (target.includes('/repos/octocat/panino-backup/git/trees')) {
                return jsonResponse({ sha: 'tree-sha' }, 201);
            }
            if (target.includes('/repos/octocat/panino-backup/git/commits')) {
                return jsonResponse({ sha: 'commit-sha-warning' }, 201);
            }
            if (target.includes('/repos/octocat/panino-backup/git/refs/heads/main') && method === 'PATCH') {
                return jsonResponse({ ref: 'refs/heads/main' });
            }

            throw new Error(`Unexpected fetch request: ${method} ${target}`);
        });

        await connectGithubBackup(app, token);
        db.prepare('UPDATE backup_config SET repo_full_name = ? WHERE provider = ?').run('octocat/panino-backup', 'github');

        const runResponse = await request(app)
            .post('/backup/github/run')
            .set('Authorization', `Bearer ${token}`)
            .send({});

        expect(runResponse.status).toBe(202);

        const status = await waitForStatus(app, token, (payload) => payload.lastBackupSha === 'commit-sha-warning');
        expect(status.lastBackupSha).toBe('commit-sha-warning');
        expect(status.lastError).toBeNull();
        expect(status.lastWarning).toContain('Skipped 1 missing image');
        expect(status.lastWarning).toContain('image.png (PDF Test)');
        expect(status.lastWarning).toContain('include them next time');
        expect(db.prepare('SELECT id FROM images WHERE id = ?').get('missing-referenced-image')).toBeDefined();
        expect(fetchMock).toHaveBeenCalled();
    });
});
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createTestApp, cleanupTestUser, getTestToken, setupTestUser } from '../../../../tests/testHelpers.js';
import { getUserDb } from '../../../../db.js';
import { readAddonRow, setAddonEnabled } from '../../../registry.js';
import {
    __resetBackupStateForTests, createOauthState, isBackupRunning, saveBackupConfig, triggerAutoBackupAfterSync, triggerDailyAutoBackup,
} from '../../backup.js';
import { githubRoutes } from '../../routes.js';
import { upgradeGithubSchema } from '../../schema.js';

describe('The GitHub add-on on the add-ons framework', () => {
    let app;
    let server;
    let user;
    let token;
    const saved = {};

    beforeAll(() => {
        for (const name of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) saved[name] = process.env[name];
        ({ app, server } = createTestApp());
    });

    afterAll(() => {
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        return new Promise((resolve) => server.close(resolve));
    });

    beforeEach(async () => {
        process.env.GITHUB_CLIENT_ID = 'github-client-id';
        process.env.GITHUB_CLIENT_SECRET = 'github-client-secret';
        __resetBackupStateForTests();
        user = await setupTestUser(`github-addon-${Date.now()}@example.test`, 'password123');
        token = getTestToken(user.userId);
    });

    afterEach(() => {
        cleanupTestUser(user.userId);
        __resetBackupStateForTests();
        vi.restoreAllMocks();
    });

    const githubEntry = async () => (await request(app).get('/addons').set('Authorization', `Bearer ${token}`))
        .body.addons.find((addon) => addon.id === 'github') || null;

    it('is listed only while the operator has a GitHub OAuth app, off by default', async () => {
        expect(await githubEntry()).toMatchObject({ id: 'github', name: 'GitHub backup', enabled: false });

        delete process.env.GITHUB_CLIENT_SECRET;
        expect(await githubEntry()).toBeNull();
        expect((await request(app).get('/addons/github/status').set('Authorization', `Bearer ${token}`)).status).toBe(404);
        expect((await request(app).get('/addons/github/callback')).status).toBe(404);
    });

    describe('the gate on the GitHub routes', () => {
        const routes = githubRoutes.stack
            .filter((layer) => layer.route)
            .flatMap((layer) => Object.keys(layer.route.methods).map((method) => ({
                method,
                path: `/addons/github${layer.route.path === '/' ? '' : layer.route.path}`,
            })));

        it('covers every GitHub route', () => {
            expect(routes.length).toBeGreaterThanOrEqual(7);
            expect(routes.every(({ path }) => !path.startsWith('/addons/github/addons'))).toBe(true);
        });

        it('answers 403 addon_disabled on every route until the user switches the add-on on', async () => {
            vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test'));
            for (const { method, path } of routes) {
                const response = await request(app)[method](path).set('Authorization', `Bearer ${token}`).send({});
                expect({ method, path, status: response.status, error: response.body.error }).toEqual({
                    method, path, status: 403, error: 'addon_disabled',
                });
            }

            await setAddonEnabled(user.userId, 'github', true);
            for (const { method, path } of routes) {
                const response = await request(app)[method](path).set('Authorization', `Bearer ${token}`).send({});
                expect({ method, path, status: response.status }).not.toEqual({ method, path, status: 403 });
            }
        });
    });

    it('refuses an OAuth return for a user who switched the add-on off, and stores nothing', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        const response = await request(app)
            .get('/addons/github/callback')
            .query({ code: 'oauth-code', state: createOauthState(user.userId) });

        expect(response.status).toBe(302);
        expect(response.headers.location).toContain('#/settings?githubBackup=error');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(getUserDb(user.userId).prepare('SELECT COUNT(*) AS count FROM backup_config').get().count).toBe(0);
    });

    it('rejects an OAuth return with a forged state', async () => {
        await setAddonEnabled(user.userId, 'github', true);
        const response = await request(app).get('/addons/github/callback').query({ code: 'oauth-code', state: 'forged' });
        expect(response.status).toBe(302);
        expect(response.headers.location).toContain('githubBackup=error');
    });

    describe('the daily backup', () => {
        function connect() {
            saveBackupConfig(getUserDb(user.userId), {
                access_token_enc: 'iv:tag:payload',
                repo_full_name: 'octocat/panino-backup',
                auto_backup_enabled: 1,
            });
        }

        it('does not start while the add-on is off, and keeps the connection', async () => {
            connect();
            await setAddonEnabled(user.userId, 'github', false);
            expect(await triggerDailyAutoBackup(user.userId)).toEqual({ started: false, reason: 'addon-off' });
            expect(getUserDb(user.userId).prepare('SELECT repo_full_name FROM backup_config').get())
                .toEqual({ repo_full_name: 'octocat/panino-backup' });
        });

        it('starts from a personal sync when due, and never from a space sync', async () => {
            connect();
            await setAddonEnabled(user.userId, 'github', true);
            vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

            triggerAutoBackupAfterSync('space:00000000-0000-4000-8000-000000000000');
            triggerAutoBackupAfterSync('not-a-db-key');
            expect(isBackupRunning(user.userId)).toBe(false);

            triggerAutoBackupAfterSync(`user:${user.userId}`);
            expect(isBackupRunning(user.userId)).toBe(true);
        });
    });

    describe('carrying over a connection made before backup was an add-on', () => {
        it('switches the add-on on for a user who had connected GitHub', () => {
            const db = getUserDb(user.userId);
            db.prepare("DELETE FROM addons WHERE addon_id = 'github'").run();
            connect(db);
            upgradeGithubSchema(db, 'user');
            expect(readAddonRow(user.userId, 'github')).toMatchObject({ enabled: 1, enabled_at: expect.stringMatching(/^\d{4}-/) });
        });

        it('leaves a user who never connected off, and never overrides a switch the user set', async () => {
            const db = getUserDb(user.userId);
            upgradeGithubSchema(db, 'user');
            expect(readAddonRow(user.userId, 'github')).toBeNull();

            await setAddonEnabled(user.userId, 'github', false);
            connect(db);
            upgradeGithubSchema(db, 'user');
            expect(readAddonRow(user.userId, 'github').enabled).toBe(0);
        });

        it('adds the columns an older backup_config lacks, without losing the row', () => {
            const db = getUserDb(user.userId);
            db.exec('DROP TABLE backup_config');
            db.exec('CREATE TABLE backup_config (id TEXT PRIMARY KEY NOT NULL, access_token_enc TEXT)');
            db.prepare("INSERT INTO backup_config (id, access_token_enc) VALUES ('old', 'iv:tag:payload')").run();
            db.prepare("DELETE FROM addons WHERE addon_id = 'github'").run();

            upgradeGithubSchema(db, 'user');
            upgradeGithubSchema(db, 'user');

            expect(db.prepare('SELECT id, provider, auto_backup_enabled, created_at FROM backup_config').get())
                .toEqual({ id: 'old', provider: 'github', auto_backup_enabled: 1, created_at: expect.stringMatching(/^\d{4}-/) });
            expect(readAddonRow(user.userId, 'github').enabled).toBe(1);
        });

        function connect(db) {
            saveBackupConfig(db, { access_token_enc: 'iv:tag:payload' });
        }
    });

    it('creates backup_config in user databases, and its upgrade does nothing to a space database', () => {
        const db = getUserDb(user.userId);
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'backup_config'").get()).toBeDefined();
        expect(() => upgradeGithubSchema(db, 'space')).not.toThrow();
    });
});

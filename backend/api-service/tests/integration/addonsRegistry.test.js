// The add-on extension points (docs/specs/active/addon-folders.md), exercised
// with a throwaway add-on so the test depends on no real one. Vitest isolates
// modules per file, so the registration does not leak into other files.
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, cleanupTestUser, generateSiteId, getTestToken, setupTestUser } from '../testHelpers.js';
import { deleteTestDb, getDb, getSpacesDb, getUserDb, registerAddonSchema } from '../../db.js';
import { createSpace } from '../../spaces.js';
import {
    addonConfigWarnings, getAddon, listAddons, registerAddon, runAddonHooks,
} from '../../addons/registry.js';

const routes = express.Router();
routes.get('/', (req, res) => res.json({ ok: true, path: req.originalUrl }));
routes.post('/things/:id', (req, res) => res.json({ id: req.params.id }));
const publicRoutes = express.Router();
publicRoutes.get('/callback', (req, res) => res.json({ public: true, signedIn: Boolean(req.user) }));
const upgrade = vi.fn();

let offered = true;
const afterChangesApplied = vi.fn();
const afterSyncRequest = vi.fn(() => { throw new Error('hook failure'); });

registerAddon({
    id: 'probe',
    name: 'Probe',
    isOffered: () => offered,
    routes,
    publicRoutes,
    schema: {
        user: 'CREATE TABLE IF NOT EXISTS probe_user_only (id TEXT PRIMARY KEY NOT NULL);',
        content: 'CREATE TABLE IF NOT EXISTS probe_everywhere (id TEXT PRIMARY KEY NOT NULL);',
        upgrade,
    },
    hooks: { afterChangesApplied, afterSyncRequest },
    configWarnings: () => ['probe is misconfigured'],
});

const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'probe_%' ORDER BY name").all().map((row) => row.name);

describe('Add-on registry extension points', () => {
    let app;
    let server;
    let user;
    let token;

    beforeAll(() => {
        ({ app, server } = createTestApp());
    });

    afterAll(() => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve())));

    beforeEach(async () => {
        offered = true;
        afterChangesApplied.mockClear();
        afterSyncRequest.mockClear();
        user = await setupTestUser(`addons-registry-${Date.now()}@example.test`, 'password123');
        token = getTestToken(user.userId);
    });

    afterEach(() => cleanupTestUser(user.userId));

    const enable = () => request(app).put('/addons/probe/enabled').set('Authorization', `Bearer ${token}`).send({ enabled: true });

    describe('routes', () => {
        it('mounts them at /addons/<id> behind the gate: 404 not offered, 403 off, then through', async () => {
            offered = false;
            expect((await request(app).get('/addons/probe').set('Authorization', `Bearer ${token}`)).status).toBe(404);

            offered = true;
            const off = await request(app).post('/addons/probe/things/7').set('Authorization', `Bearer ${token}`);
            expect(off.status).toBe(403);
            expect(off.body.error).toBe('addon_disabled');

            await enable();
            const root = await request(app).get('/addons/probe').set('Authorization', `Bearer ${token}`);
            expect(root.body).toEqual({ ok: true, path: '/addons/probe' });
            expect((await request(app).post('/addons/probe/things/7').set('Authorization', `Bearer ${token}`)).body).toEqual({ id: '7' });
        });

        it('requires a signed-in user before the add-on is reached', async () => {
            expect((await request(app).get('/addons/probe')).status).toBe(401);
        });

        it('mounts public routes before sign-in, behind the offered check only', async () => {
            const anonymous = await request(app).get('/addons/probe/callback');
            expect(anonymous.status).toBe(200);
            expect(anonymous.body).toEqual({ public: true, signedIn: false });

            offered = false;
            expect((await request(app).get('/addons/probe/callback')).status).toBe(404);
        });

        it('keeps the gate on the private routes when public routes share the prefix', async () => {
            expect((await request(app).get('/addons/probe')).status).toBe(401);
            expect((await request(app).post('/addons/probe/things/7').set('Authorization', `Bearer ${token}`)).status).toBe(403);
        });

        it('refuses public routes that are not a Router', () => {
            expect(() => registerAddon({ id: 'bad-public', name: 'x', isOffered: () => true, publicRoutes: {} })).toThrow(/Router/);
        });

        it('leaves the switch route to the framework', async () => {
            const response = await enable();
            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({ id: 'probe', enabled: true });
        });
    });

    describe('schema', () => {
        it('creates content tables in user and space databases and user tables in user databases only', () => {
            expect(tables(getUserDb(user.userId))).toEqual(['probe_everywhere', 'probe_user_only']);

            const saved = process.env.SHARED_SPACES_ENABLED;
            process.env.SHARED_SPACES_ENABLED = 'true';
            const { spaceId } = createSpace({ actorUserId: user.userId, name: `Probe ${Date.now()}` });
            const dbKey = `space:${spaceId}`;
            try {
                expect(tables(getDb(dbKey))).toEqual(['probe_everywhere']);
            } finally {
                deleteTestDb(dbKey);
                getSpacesDb().prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
                getSpacesDb().prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
                if (saved === undefined) delete process.env.SHARED_SPACES_ENABLED;
                else process.env.SHARED_SPACES_ENABLED = saved;
            }
        });

        it('creates tables whether or not the operator offers the add-on', () => {
            offered = false;
            expect(tables(getUserDb(user.userId))).toContain('probe_user_only');
        });

        it('runs schema.upgrade after the add-on SQL, with the database kind', () => {
            upgrade.mockClear();
            getUserDb(user.userId);
            expect(upgrade).toHaveBeenCalledWith(expect.anything(), 'user');
        });

        it('refuses a schema.upgrade that is not a function', () => {
            expect(() => registerAddonSchema('bad-upgrade', { upgrade: 'ALTER TABLE x' })).toThrow(/function/);
        });

        it('refuses add-on tables that would become CRRs', () => {
            expect(() => registerAddonSchema('bad', { content: "SELECT crsql_as_crr('x');" })).toThrow(/server-only/);
        });
    });

    describe('hooks', () => {
        it('runs afterChangesApplied and afterSyncRequest from /sync, and a throwing hook does not fail the sync', async () => {
            const siteId = generateSiteId('p');
            const response = await request(app).post('/sync').set('Authorization', `Bearer ${token}`).send({
                since: 0,
                siteId,
                changes: [{
                    table: 'notes', pk: '["probe-note"]', cid: 'title', val: '"Probe"',
                    col_version: 1, db_version: 1, site_id: siteId, cl: 0, seq: 1,
                }],
            });
            expect(response.status).toBe(200);
            expect(afterChangesApplied).toHaveBeenCalledWith(`user:${user.userId}`);
            expect(afterSyncRequest).toHaveBeenCalledWith(`user:${user.userId}`);
        });

        it('skips add-ons the operator does not offer', () => {
            offered = false;
            runAddonHooks('afterChangesApplied', 'user:x');
            expect(afterChangesApplied).not.toHaveBeenCalled();
        });

        it('refuses a hook core does not know', () => {
            expect(() => registerAddon({ id: 'typo', name: 'Typo', isOffered: () => true, hooks: { afterChange: () => {} } })).toThrow(/unknown hook/);
            expect(getAddon('typo')).toBeNull();
        });
    });

    describe('config warnings', () => {
        it('prefixes each warning with the add-on id', () => {
            expect(addonConfigWarnings()).toContain('[addons:probe] probe is misconfigured');
        });
    });

    it('lists the throwaway add-on beside the ones that ship', () => {
        expect(listAddons().map((addon) => addon.id)).toContain('probe');
    });
});

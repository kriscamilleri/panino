import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import {
  createTestApp,
  setupTestUser,
  cleanupTestUser,
  getTestToken,
  generateSiteId,
} from '../testHelpers.js';
import { getUserDb } from '../../db.js';

function insertRevision(db, { id, noteId, title, content, type = 'auto', createdAt = "datetime('now')" }) {
  const safeContent = String(content ?? '');
  const gz = gzipSync(Buffer.from(safeContent, 'utf8'));
  const sha = createHash('sha256').update(safeContent, 'utf8').digest('hex');
  db.prepare(`
    INSERT INTO note_revisions (
      id, note_id, title, content_gzip, type, content_sha256,
      uncompressed_bytes, compressed_bytes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${createdAt})
  `).run(id, noteId, title ?? null, gz, type, sha, Buffer.byteLength(safeContent, 'utf8'), gz.length);
}

function bufferToNumericKeyObject(buffer) {
  return Object.fromEntries([...buffer].map((value, index) => [String(index), value]));
}

describe('Sync revision capture', () => {
  let app;
  let server;
  let testUser;
  let token;

  beforeAll(() => {
    const created = createTestApp();
    app = created.app;
    server = created.server;
  });

  beforeEach(async () => {
    testUser = await setupTestUser(`sync-revision-${Date.now()}@example.com`, 'password123');
    token = getTestToken(testUser.userId);

    const db = getUserDb(testUser.userId);
    db.prepare(`
      INSERT INTO notes (id, user_id, title, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run('note-sync', testUser.userId, 'Base title', '# base content');
  });

  afterEach(() => {
    if (testUser) cleanupTestUser(testUser.userId);
  });

  afterAll(() => new Promise((resolve) => {
    if (server) return server.close(resolve);
    return resolve();
  }));

  it('captures content/title changes directly from incoming change set', async () => {
    const siteId = generateSiteId('c');

    const response = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: 'notes',
            pk: '["note-sync"]',
            cid: 'title',
            val: '"New title"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 0,
            seq: 1,
          },
          {
            table: 'notes',
            pk: '["note-sync"]',
            cid: 'content',
            val: '"# from change set"',
            col_version: 1,
            db_version: 2,
            site_id: siteId,
            cl: 0,
            seq: 2,
          },
        ],
      });

    expect(response.status).toBe(200);

    const db = getUserDb(testUser.userId);
    const latest = db.prepare(`
      SELECT title, type
      FROM note_revisions
      WHERE note_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `).get('note-sync');

    expect(latest).toBeDefined();
    expect(latest.title).toBe('New title');
    expect(latest.type).toBe('auto');
  });

  it('captures auto revision when note pk is sent as packed numeric-key object', async () => {
    const siteId = generateSiteId('k');
    const db = getUserDb(testUser.userId);
    const packedPk = db.prepare('SELECT crsql_pack_columns(?) as pk').get('note-sync').pk;

    const response = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: 'notes',
            pk: bufferToNumericKeyObject(packedPk),
            cid: 'content',
            val: '"# from packed pk"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 0,
            seq: 1,
          },
        ],
      });

    expect(response.status).toBe(200);

    const latest = db.prepare(`
      SELECT note_id, type
      FROM note_revisions
      WHERE note_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `).get('note-sync');

    expect(latest).toBeDefined();
    expect(latest.note_id).toBe('note-sync');
    expect(latest.type).toBe('auto');
  });

  it('keeps the last content value when multiple content changes exist in one payload', async () => {
    const siteId = generateSiteId('g');

    const response = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: 'notes',
            pk: '["note-sync"]',
            cid: 'content',
            val: '"# first"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 0,
            seq: 1,
          },
          {
            table: 'notes',
            pk: '["note-sync"]',
            cid: 'content',
            val: '"# second"',
            col_version: 2,
            db_version: 2,
            site_id: siteId,
            cl: 0,
            seq: 2,
          },
        ],
      });

    expect(response.status).toBe(200);

    const db = getUserDb(testUser.userId);
    const latestRevision = db.prepare(`
      SELECT id
      FROM note_revisions
      WHERE note_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `).get('note-sync');

    const detail = await request(app)
      .get(`/notes/note-sync/revisions/${latestRevision.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.status).toBe(200);
    expect(detail.body.revision.content).toBe('# second');
  });

  it('captures title-only change using existing base-table content', async () => {
    const siteId = generateSiteId('d');

    const response = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: 'notes',
            pk: '["note-sync"]',
            cid: 'title',
            val: '"Renamed only"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 0,
            seq: 1,
          },
        ],
      });

    expect(response.status).toBe(200);

    const db = getUserDb(testUser.userId);
    const latest = db.prepare(`
      SELECT content_gzip
      FROM note_revisions
      WHERE note_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `).get('note-sync');

    expect(latest).toBeDefined();

    const detail = await request(app)
      .get('/notes/note-sync/revisions/' + db.prepare(`
        SELECT id FROM note_revisions WHERE note_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1
      `).get('note-sync').id)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.status).toBe(200);
    expect(detail.body.revision.content).toBe('# base content');
  });

  it('enforces auto capture throttle across rapid sync requests', async () => {
    const siteId1 = generateSiteId('h');
    const siteId2 = generateSiteId('i');

    const first = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({
        since: 0,
        siteId: siteId1,
        changes: [
          {
            table: 'notes',
            pk: '["note-sync"]',
            cid: 'content',
            val: '"# throttle-1"',
            col_version: 1,
            db_version: 1,
            site_id: siteId1,
            cl: 0,
            seq: 1,
          },
        ],
      });

    const second = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({
        since: 0,
        siteId: siteId2,
        changes: [
          {
            table: 'notes',
            pk: '["note-sync"]',
            cid: 'content',
            val: '"# throttle-2"',
            col_version: 2,
            db_version: 2,
            site_id: siteId2,
            cl: 0,
            seq: 1,
          },
        ],
      });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const db = getUserDb(testUser.userId);
    const autoCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM note_revisions
      WHERE note_id = ? AND type = 'auto'
    `).get('note-sync');

    expect(autoCount.count).toBe(1);
  });

  it('creates a new auto revision after throttle window has elapsed', async () => {
    const db = getUserDb(testUser.userId);
    insertRevision(db, {
      id: 'old-auto',
      noteId: 'note-sync',
      title: 'Older auto',
      content: '# old throttle content',
      type: 'auto',
      createdAt: "datetime('now', '-6 minutes')",
    });

    const siteId = generateSiteId('j');
    const response = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: 'notes',
            pk: '["note-sync"]',
            cid: 'content',
            val: '"# new post-window content"',
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 0,
            seq: 1,
          },
        ],
      });

    expect(response.status).toBe(200);

    const autoCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM note_revisions
      WHERE note_id = ? AND type = 'auto'
    `).get('note-sync');

    expect(autoCount.count).toBe(2);
  });

  it('enforces auth from JWT middleware only', async () => {
    const response = await request(app)
      .post('/sync')
      .send({
        userId: testUser.userId,
        since: 0,
        siteId: generateSiteId('e'),
        changes: [],
      });

    expect(response.status).toBe(401);
  });

  it('proactively deletes revisions on notes tombstone change', async () => {
    const db = getUserDb(testUser.userId);
    db.prepare(`
      INSERT INTO note_revisions (
        id, note_id, title, content_gzip, type, content_sha256,
        uncompressed_bytes, compressed_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run('rev-to-delete', 'note-sync', 'Title', Buffer.from([31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'manual', 'hash', 0, 20);

    const siteId = generateSiteId('f');
    const response = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({
        since: 0,
        siteId,
        changes: [
          {
            table: 'notes',
            pk: '["note-sync"]',
            cid: '-1',
            val: null,
            col_version: 1,
            db_version: 1,
            site_id: siteId,
            cl: 1,
            seq: 1,
          },
        ],
      });

    expect(response.status).toBe(200);

    const remaining = db.prepare('SELECT COUNT(*) as count FROM note_revisions WHERE note_id = ?').get('note-sync');
    expect(remaining.count).toBe(0);
  });
});

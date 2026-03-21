import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';
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

const WS_PORT = 8012;

function insertRevision(db, { id, noteId, title, content, type = 'manual', createdAt = "datetime('now')" }) {
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

describe('Revision API', () => {
  let app;
  let server;
  let testUser;
  let token;

  beforeAll(() => {
    const created = createTestApp();
    app = created.app;
    server = created.server;

    return new Promise((resolve) => {
      server.listen(WS_PORT, resolve);
    });
  });

  beforeEach(async () => {
    testUser = await setupTestUser(`revision-${Date.now()}@example.com`, 'password123');
    token = getTestToken(testUser.userId);

    const db = getUserDb(testUser.userId);
    db.prepare(`
      INSERT INTO notes (id, user_id, title, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run('note-1', testUser.userId, 'Original', '# original');
  });

  afterEach(() => {
    if (testUser) cleanupTestUser(testUser.userId);
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('creates manual revision, lists it, and fetches detail', async () => {
    const createResponse = await request(app)
      .post('/notes/note-1/revisions')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect([200, 201]).toContain(createResponse.status);

    const listResponse = await request(app)
      .get('/notes/note-1/revisions?limit=50')
      .set('Authorization', `Bearer ${token}`);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.revisions)).toBe(true);
    expect(listResponse.body.revisions.length).toBeGreaterThan(0);

    const revisionId = listResponse.body.revisions[0].id;
    const detailResponse = await request(app)
      .get(`/notes/note-1/revisions/${revisionId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.revision.content).toBe('# original');
  });

  it('returns 422 for corrupt compressed revision payload', async () => {
    const db = getUserDb(testUser.userId);
    db.prepare(`
      INSERT INTO note_revisions (
        id, note_id, title, content_gzip, type, content_sha256,
        uncompressed_bytes, compressed_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run('bad-revision', 'note-1', 'Bad', Buffer.from('not-gzip'), 'manual', 'x', 8, 8);

    const response = await request(app)
      .get('/notes/note-1/revisions/bad-revision')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(422);
  });

  it('skips duplicate manual revision creation', async () => {
    const first = await request(app)
      .post('/notes/note-1/revisions')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(first.status).toBe(201);

    const duplicate = await request(app)
      .post('/notes/note-1/revisions')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({ created: false, reason: 'duplicate-latest' });

    const db = getUserDb(testUser.userId);
    const count = db.prepare('SELECT COUNT(*) AS count FROM note_revisions WHERE note_id = ?').get('note-1');
    expect(count.count).toBe(1);
  });

  it('enforces revision-to-note ownership on detail route', async () => {
    const db = getUserDb(testUser.userId);
    db.prepare(`
      INSERT INTO notes (id, user_id, title, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run('note-2', testUser.userId, 'Second', '# second');

    insertRevision(db, {
      id: 'rev-note-2',
      noteId: 'note-2',
      title: 'Second note revision',
      content: '# second',
    });

    const response = await request(app)
      .get('/notes/note-1/revisions/rev-note-2')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });

  it('supports cursor pagination with before + beforeId tie-breaker', async () => {
    const db = getUserDb(testUser.userId);
    insertRevision(db, { id: 'rev-a', noteId: 'note-1', title: 'A', content: '# a', createdAt: "'2026-02-17T10:00:00.000Z'" });
    insertRevision(db, { id: 'rev-b', noteId: 'note-1', title: 'B', content: '# b', createdAt: "'2026-02-17T10:00:00.000Z'" });
    insertRevision(db, { id: 'rev-c', noteId: 'note-1', title: 'C', content: '# c', createdAt: "'2026-02-17T10:00:00.000Z'" });

    const firstPage = await request(app)
      .get('/notes/note-1/revisions?limit=2')
      .set('Authorization', `Bearer ${token}`);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.revisions.map((r) => r.id)).toEqual(['rev-c', 'rev-b']);

    const secondPage = await request(app)
      .get('/notes/note-1/revisions?limit=2&before=2026-02-17T10:00:00.000Z&beforeId=rev-b')
      .set('Authorization', `Bearer ${token}`);

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.revisions.map((r) => r.id)).toEqual(['rev-a']);
  });

  it('restores selected revision and creates pre-restore snapshot', async () => {
    const db = getUserDb(testUser.userId);

    await request(app)
      .post('/notes/note-1/revisions')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    db.prepare('UPDATE notes SET title = ?, content = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run('Changed', '# changed', 'note-1');

    const latestRevision = db.prepare(`
      SELECT id
      FROM note_revisions
      WHERE note_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `).get('note-1');

    const restoreResponse = await request(app)
      .post(`/notes/note-1/revisions/${latestRevision.id}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(restoreResponse.status).toBe(200);
    expect(restoreResponse.body.restored).toBe(true);
    expect(restoreResponse.body.note.content).toBe('# original');
    expect(restoreResponse.body.preRestoreRevisionId).toBeTruthy();

    const preRestore = db.prepare('SELECT type FROM note_revisions WHERE id = ?').get(restoreResponse.body.preRestoreRevisionId);
    expect(preRestore.type).toBe('pre-restore');
  });

  it('returns 409 when expectedUpdatedAt mismatches current note version', async () => {
    const db = getUserDb(testUser.userId);

    await request(app)
      .post('/notes/note-1/revisions')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const revision = db.prepare('SELECT id FROM note_revisions WHERE note_id = ? LIMIT 1').get('note-1');
    const current = db.prepare('SELECT updated_at FROM notes WHERE id = ?').get('note-1');
    const mismatchedTimestamp = `${current.updated_at}__mismatch`;

    const restoreResponse = await request(app)
      .post(`/notes/note-1/revisions/${revision.id}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: mismatchedTimestamp });

    expect(restoreResponse.status).toBe(409);
  });

  it('keeps source revision readable after restore so it can be reopened', async () => {
    const db = getUserDb(testUser.userId);

    const createResponse = await request(app)
      .post('/notes/note-1/revisions')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(createResponse.status).toBe(201);
    const sourceRevisionId = createResponse.body.revisionId;

    const openedBeforeRestore = await request(app)
      .get(`/notes/note-1/revisions/${sourceRevisionId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(openedBeforeRestore.status).toBe(200);
    expect(openedBeforeRestore.body.revision.content).toBe('# original');

    db.prepare('UPDATE notes SET title = ?, content = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run('Changed after checkpoint', '# changed after checkpoint', 'note-1');

    const restoreResponse = await request(app)
      .post(`/notes/note-1/revisions/${sourceRevisionId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(restoreResponse.status).toBe(200);
    expect(restoreResponse.body.restored).toBe(true);

    const reopenedAfterRestore = await request(app)
      .get(`/notes/note-1/revisions/${sourceRevisionId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(reopenedAfterRestore.status).toBe(200);
    expect(reopenedAfterRestore.body.revision.content).toBe('# original');
  });

  it('sends websocket sync poke after restore', async () => {
    const db = getUserDb(testUser.userId);

    await request(app)
      .post('/notes/note-1/revisions')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const revision = db.prepare('SELECT id FROM note_revisions WHERE note_id = ? LIMIT 1').get('note-1');

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${WS_PORT}?token=${token}&siteId=${generateSiteId('b')}`);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Did not receive sync poke after restore'));
      }, 5000);

      ws.on('open', async () => {
        try {
          await request(app)
            .post(`/notes/note-1/revisions/${revision.id}/restore`)
            .set('Authorization', `Bearer ${token}`)
            .send({});
        } catch (error) {
          clearTimeout(timeout);
          ws.close();
          reject(error);
        }
      });

      ws.on('message', (buffer) => {
        const msg = JSON.parse(buffer.toString());
        if (msg.type === 'sync') {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        ws.close();
        reject(error);
      });
    });
  });
});

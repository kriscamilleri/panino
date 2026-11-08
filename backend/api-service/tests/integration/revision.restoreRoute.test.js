// The app's restore route answers exactly as it did before the restore moved into
// restoreNoteRevision (shared with the AI agents add-on).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { cleanupTestUser, createTestApp, getTestToken, setupTestUser } from '../testHelpers.js';
import { getUserDb } from '../../db.js';

describe('POST /notes/:id/revisions/:revisionId/restore responses', () => {
  let app;
  let server;
  let user;
  let token;
  let revisionId;

  beforeAll(() => {
    ({ app, server } = createTestApp());
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(async () => {
    user = await setupTestUser(`revision-restore-${Date.now()}@example.com`, 'password123');
    token = getTestToken(user.userId);
    const db = getUserDb(user.userId);
    db.prepare(`INSERT INTO notes (id, user_id, title, content, created_at, updated_at)
                VALUES ('note-1', ?, 'Original', '# original', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z')`).run(user.userId);
    const saved = await request(app).post('/notes/note-1/revisions').set('Authorization', `Bearer ${token}`).send({});
    revisionId = saved.body.revisionId;
    db.prepare("UPDATE notes SET content = '# changed' WHERE id = 'note-1'").run();
  });
  afterEach(() => cleanupTestUser(user.userId));

  const restore = (id, rev, body = {}) => request(app)
    .post(`/notes/${id}/revisions/${rev}/restore`).set('Authorization', `Bearer ${token}`).send(body);

  it('answers 200 with restored, note and preRestoreRevisionId only, and no after-revision', async () => {
    const res = await restore('note-1', revisionId);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['note', 'preRestoreRevisionId', 'restored']);
    expect(Object.keys(res.body.note).sort()).toEqual(['content', 'id', 'title', 'updatedAt']);
    const rows = getUserDb(user.userId).prepare(`SELECT type, actor_kind, actor_user_id FROM note_revisions
                                                  WHERE note_id = 'note-1' ORDER BY created_at, rowid`).all();
    expect(rows).toEqual([
      { type: 'manual', actor_kind: 'system', actor_user_id: user.userId },
      { type: 'pre-restore', actor_kind: 'system', actor_user_id: user.userId },
    ]);
  });

  it('answers 404 Not found for an unknown note or revision, and 409 Conflict for a stale version', async () => {
    for (const res of [await restore('missing', revisionId), await restore('note-1', 'missing')]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    }
    const stale = await restore('note-1', revisionId, { expectedUpdatedAt: 'stale' });
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ error: 'Conflict' });
  });

  it('answers 422 for a corrupt revision', async () => {
    getUserDb(user.userId).prepare("UPDATE note_revisions SET content_gzip = x'00' WHERE id = ?").run(revisionId);
    const res = await restore('note-1', revisionId);
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'Revision payload is corrupt' });
  });
});

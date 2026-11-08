// restoreNoteRevision: the restore shared by the app's restore route and the AI
// agents add-on (docs/specs/proposed/ai-api-expansion.md §4.4).
import { afterEach, describe, expect, it } from 'vitest';
import { closeAllConnections, getTestDb } from '../../db.js';
import { createRevisionSnapshot, restoreNoteRevision, RevisionRestoreError } from '../../revision.js';

function setup(name) {
  const db = getTestDb(`revision-restore-${name}-${Date.now()}`, { inMemory: true });
  db.prepare(`INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run('note-1', 'Old title', 'old body', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  const { revisionId } = createRevisionSnapshot(db, { noteId: 'note-1', title: 'Old title', content: 'old body', type: 'manual' });
  db.prepare("UPDATE notes SET title = 'New title', content = 'new body', updated_at = '2026-11-02T10:00:00.000Z' WHERE id = 'note-1'").run();
  return { db, revisionId };
}

function revisions(db) {
  return db.prepare(`SELECT type, title, actor_user_id, actor_kind, actor_label FROM note_revisions
                      WHERE note_id = 'note-1' ORDER BY created_at, rowid`).all();
}

function refusal(fn) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RevisionRestoreError);
    return { code: error.code, httpStatus: error.httpStatus };
  }
  throw new Error('expected a refusal');
}

describe('restoreNoteRevision', () => {
  afterEach(() => closeAllConnections());

  it('saves a pre-restore revision and writes the revision back, as the app route does', () => {
    const { db, revisionId } = setup('app');
    const result = restoreNoteRevision(db, {
      noteId: 'note-1', revisionId, preRestoreActor: { userId: 'u-1', kind: 'system' },
    });
    expect(Object.keys(result).sort()).toEqual(['note', 'preRestoreRevisionId', 'restored']);
    expect(result.note).toMatchObject({ id: 'note-1', title: 'Old title', content: 'old body' });
    expect(db.prepare("SELECT title, content, updated_at FROM notes WHERE id = 'note-1'").get())
      .toEqual({ title: 'Old title', content: 'old body', updated_at: result.note.updatedAt });
    expect(revisions(db)).toEqual([
      { type: 'manual', title: 'Old title', actor_user_id: null, actor_kind: null, actor_label: null },
      { type: 'pre-restore', title: 'New title', actor_user_id: 'u-1', actor_kind: 'system', actor_label: null },
    ]);
  });

  it('records an attributed after-revision when asked', () => {
    const { db, revisionId } = setup('after');
    const result = restoreNoteRevision(db, {
      noteId: 'note-1', revisionId, afterActor: { userId: 'u-1', kind: 'api', label: 'Claude Code' },
    });
    expect(result.afterRevisionId).toBeTruthy();
    expect(revisions(db).slice(1)).toEqual([
      { type: 'pre-restore', title: 'New title', actor_user_id: null, actor_kind: null, actor_label: null },
      { type: 'auto', title: 'Old title', actor_user_id: 'u-1', actor_kind: 'api', actor_label: 'Claude Code' },
    ]);
  });

  it('refuses with the app route\'s codes and statuses, writing nothing', () => {
    const { db, revisionId } = setup('refuse');
    expect(refusal(() => restoreNoteRevision(db, { noteId: 'missing', revisionId })))
      .toEqual({ code: 'NOTE_NOT_FOUND', httpStatus: 404 });
    expect(refusal(() => restoreNoteRevision(db, { noteId: 'note-1', revisionId, expectedUpdatedAt: 'stale' })))
      .toEqual({ code: 'VERSION_CONFLICT', httpStatus: 409 });
    expect(refusal(() => restoreNoteRevision(db, { noteId: 'note-1', revisionId: 'missing' })))
      .toEqual({ code: 'REVISION_NOT_FOUND', httpStatus: 404 });
    db.prepare("UPDATE note_revisions SET content_gzip = x'00' WHERE id = ?").run(revisionId);
    expect(refusal(() => restoreNoteRevision(db, { noteId: 'note-1', revisionId })))
      .toEqual({ code: 'CORRUPT_REVISION', httpStatus: 422 });
    expect(revisions(db)).toHaveLength(1);
    expect(db.prepare("SELECT content FROM notes WHERE id = 'note-1'").get().content).toBe('new body');
  });

  it('accepts a matching expectedUpdatedAt', () => {
    const { db, revisionId } = setup('expected');
    const result = restoreNoteRevision(db, { noteId: 'note-1', revisionId, expectedUpdatedAt: '2026-11-02T10:00:00.000Z' });
    expect(result.restored).toBe(true);
  });
});

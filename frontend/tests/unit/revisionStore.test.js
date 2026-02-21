import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../src/store/authStore.js', () => ({
  useAuthStore: () => ({ token: 'test-token' }),
}));

import { useRevisionStore } from '../../src/store/revisionStore.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('revisionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('loads first page and sets pagination state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      revisions: [
        {
          id: 'rev-1',
          noteId: 'note-1',
          title: 'Title',
          type: 'auto',
          createdAt: '2026-02-17T10:00:00.000Z',
          uncompressedBytes: 20,
          compressedBytes: 10,
        },
      ],
    }));

    const store = useRevisionStore();
    await store.fetchRevisions('note-1', { reset: true, limit: 50 });

    expect(store.revisions).toHaveLength(1);
    expect(store.hasMore).toBe(false);
    expect(store.listError).toBe('');
  });

  it('fetches detail lazily and caches result', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      revision: {
        id: 'rev-1',
        noteId: 'note-1',
        title: 'Title',
        type: 'manual',
        createdAt: '2026-02-17T10:00:00.000Z',
        content: '# markdown',
      },
    }));

    const store = useRevisionStore();
    await store.fetchRevisionDetail('note-1', 'rev-1');
    await store.fetchRevisionDetail('note-1', 'rev-1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(store.selectedRevisionId).toBe('rev-1');
    expect(store.selectedRevisionDetail.content).toBe('# markdown');
  });

  it('restores revision and refreshes list', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({
        restored: true,
        note: {
          id: 'note-1',
          title: 'Restored',
          content: '# restored',
          updatedAt: '2026-02-17T11:00:00.000Z',
        },
        preRestoreRevisionId: 'rev-pre',
      }))
      .mockResolvedValueOnce(jsonResponse({ revisions: [] }));

    const store = useRevisionStore();
    const result = await store.restoreRevision('note-1', 'rev-1', '2026-02-17T10:00:00.000Z');

    expect(result.restored).toBe(true);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8000/notes/note-1/revisions/rev-1/restore',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('clears opened revision state when resetState is called (close behavior)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        revision: {
          id: 'rev-1',
          noteId: 'note-1',
          title: 'Title',
          type: 'manual',
          createdAt: '2026-02-17T10:00:00.000Z',
          content: '# markdown',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        revision: {
          id: 'rev-1',
          noteId: 'note-1',
          title: 'Title',
          type: 'manual',
          createdAt: '2026-02-17T10:00:00.000Z',
          content: '# markdown',
        },
      }));

    const store = useRevisionStore();
    await store.fetchRevisionDetail('note-1', 'rev-1');
    expect(store.selectedRevisionId).toBe('rev-1');
    expect(store.selectedRevisionDetail.content).toBe('# markdown');

    store.resetState();
    expect(store.selectedRevisionId).toBe(null);
    expect(store.selectedRevisionDetail).toBe(null);

    await store.fetchRevisionDetail('note-1', 'rev-1');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('clears selected revision when restore refresh no longer includes that revision', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({
        revision: {
          id: 'rev-selected',
          noteId: 'note-1',
          title: 'Old',
          type: 'manual',
          createdAt: '2026-02-17T10:00:00.000Z',
          content: '# old',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        restored: true,
        note: {
          id: 'note-1',
          title: 'Restored',
          content: '# restored',
          updatedAt: '2026-02-17T11:00:00.000Z',
        },
        preRestoreRevisionId: 'rev-pre',
      }))
      .mockResolvedValueOnce(jsonResponse({
        revisions: [
          {
            id: 'rev-other',
            noteId: 'note-1',
            title: 'Other',
            type: 'auto',
            createdAt: '2026-02-17T11:00:01.000Z',
            uncompressedBytes: 12,
            compressedBytes: 8,
          },
        ],
      }));

    const store = useRevisionStore();
    await store.fetchRevisionDetail('note-1', 'rev-selected');
    expect(store.selectedRevisionId).toBe('rev-selected');

    await store.restoreRevision('note-1', 'rev-selected', '2026-02-17T10:00:00.000Z');
    expect(store.selectedRevisionId).toBe(null);
    expect(store.revisions.map((r) => r.id)).toEqual(['rev-other']);
  });

  it('reopens the same revision id after restore by refetching detail', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({
        revision: {
          id: 'rev-selected',
          noteId: 'note-1',
          title: 'Checkpoint',
          type: 'manual',
          createdAt: '2026-02-17T10:00:00.000Z',
          content: '# checkpoint',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        restored: true,
        note: {
          id: 'note-1',
          title: 'Restored',
          content: '# restored',
          updatedAt: '2026-02-17T11:00:00.000Z',
        },
        preRestoreRevisionId: 'rev-pre',
      }))
      .mockResolvedValueOnce(jsonResponse({
        revisions: [
          {
            id: 'rev-selected',
            noteId: 'note-1',
            title: 'Checkpoint',
            type: 'manual',
            createdAt: '2026-02-17T10:00:00.000Z',
            uncompressedBytes: 12,
            compressedBytes: 8,
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        revision: {
          id: 'rev-selected',
          noteId: 'note-1',
          title: 'Checkpoint',
          type: 'manual',
          createdAt: '2026-02-17T10:00:00.000Z',
          content: '# checkpoint',
        },
      }));

    const store = useRevisionStore();

    await store.fetchRevisionDetail('note-1', 'rev-selected');
    expect(store.selectedRevisionId).toBe('rev-selected');
    expect(store.selectedRevisionDetail.content).toBe('# checkpoint');

    await store.restoreRevision('note-1', 'rev-selected', '2026-02-17T10:00:00.000Z');
    expect(store.selectedRevisionId).toBe(null);

    await store.fetchRevisionDetail('note-1', 'rev-selected');
    expect(store.selectedRevisionId).toBe('rev-selected');
    expect(store.selectedRevisionDetail.content).toBe('# checkpoint');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});

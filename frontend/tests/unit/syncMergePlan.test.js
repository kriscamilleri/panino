import { describe, expect, it } from 'vitest';
import { planRemoteContent, resolveServerValue } from '@/utils/syncMerge.js';

const BASE = 'title\n\nalpha\n\nbeta\n';
const MINE = 'title\n\nalpha edited here\n\nbeta\n';
const REMOTE = 'title\n\nalpha\n\nbeta edited there\n';
const MERGED = 'title\n\nalpha edited here\n\nbeta edited there\n';
const CLASH = 'title\n\nalpha rewritten there\n\nbeta\n';

/** Defaults describe a replica with a base, a local row, and nothing pending. */
const plan = (overrides) => planRemoteContent({
  hasBase: true,
  base: BASE,
  hasLocalRow: true,
  mine: BASE,
  remote: REMOTE,
  postApply: REMOTE,
  localPending: false,
  serverValue: REMOTE,
  capabilityEnabled: false,
  ...overrides,
});

describe('resolveServerValue', () => {
  it('is the remote value when this replica uploaded nothing for the document', () => {
    expect(resolveServerValue({ remote: REMOTE, remoteColVersion: 4, sent: null, postApply: MINE })).toBe(REMOTE);
  });

  it('follows the higher column version', () => {
    const sent = { content: MINE, colVersion: 7 };
    expect(resolveServerValue({ remote: REMOTE, remoteColVersion: 9, sent, postApply: REMOTE })).toBe(REMOTE);
    expect(resolveServerValue({ remote: REMOTE, remoteColVersion: 5, sent, postApply: MINE })).toBe(MINE);
  });

  it('reads a tie off the local outcome while the local value is still the one sent', () => {
    const sent = { content: MINE, colVersion: 7 };
    expect(resolveServerValue({ remote: REMOTE, remoteColVersion: 7, sent, postApply: REMOTE })).toBe(REMOTE);
    expect(resolveServerValue({ remote: REMOTE, remoteColVersion: 7, sent, postApply: MINE })).toBe(MINE);
  });

  it('admits it cannot tell a tie once the local value changed after sending', () => {
    const sent = { content: MINE, colVersion: 7 };
    expect(resolveServerValue({
      remote: REMOTE, remoteColVersion: 7, sent, postApply: MINE, localChangedSinceSend: true,
    })).toBeUndefined();
  });
});

describe('planRemoteContent: nothing pending locally', () => {
  it('adopts a newer remote body and records it as the base', () => {
    expect(plan({})).toEqual({ action: 'adopt', base: REMOTE, conflicts: [] });
  });

  it('adopts without a conflict when no base exists yet (stale device after upgrade)', () => {
    // The device never edited the document; its copy is simply old.
    expect(plan({ hasBase: false, base: undefined }))
      .toEqual({ action: 'adopt', base: REMOTE, conflicts: [] });
  });

  it('adopts a document this replica never held', () => {
    expect(plan({ hasBase: false, hasLocalRow: false, mine: '' }))
      .toEqual({ action: 'adopt', base: REMOTE, conflicts: [] });
  });

  it('treats matching bodies as agreement even while an upload is pending', () => {
    expect(plan({ mine: REMOTE, localPending: true, postApply: REMOTE }))
      .toEqual({ action: 'adopt', base: REMOTE, conflicts: [] });
  });
});

describe('planRemoteContent: concurrent edits with a known base', () => {
  const concurrent = { mine: MINE, localPending: true };

  it('keeps both sides for the user when automatic merging is off', () => {
    const result = plan({ ...concurrent, postApply: REMOTE, serverValue: REMOTE });
    expect(result).toMatchObject({
      action: 'record-conflict',
      reason: 'writeback-disabled',
      base: REMOTE,
      conflicts: [],
    });
    expect(result.pendingMerged).toBe(MERGED);
  });

  it('writes the merged body when automatic merging is on', () => {
    expect(plan({ ...concurrent, postApply: REMOTE, serverValue: REMOTE, capabilityEnabled: true }))
      .toEqual({ action: 'write-merge', content: MERGED, base: REMOTE, conflicts: [] });
  });

  it('still sees the other edit when the local upload won on the server', () => {
    // The server replied with the value it held before merging this upload.
    // The stored body is still the local one; the base becomes what the server holds now.
    const result = plan({ ...concurrent, postApply: MINE, serverValue: MINE, capabilityEnabled: true });
    expect(result).toEqual({ action: 'write-merge', content: MERGED, base: MINE, conflicts: [] });
  });

  it('records overlapping edits as a conflict with the clashing region', () => {
    const result = plan({ ...concurrent, remote: CLASH, postApply: CLASH, serverValue: CLASH, capabilityEnabled: true });
    expect(result.action).toBe('record-conflict');
    expect(result.base).toBe(CLASH);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].mineLines.join('\n')).toContain('alpha edited here');
    expect(result.conflicts[0].theirsLines.join('\n')).toContain('alpha rewritten there');
  });

  it('uses the open editor draft as the local side', () => {
    // `mine` is the unsaved draft; nothing was uploaded for it yet.
    const result = plan({ mine: MINE, localPending: true, postApply: REMOTE, serverValue: REMOTE, capabilityEnabled: true });
    expect(result).toMatchObject({ action: 'write-merge', content: MERGED });
  });

  it('restores the local body when the remote row carried nothing new', () => {
    expect(plan({ ...concurrent, remote: BASE, postApply: BASE, serverValue: BASE }))
      .toEqual({ action: 'write', content: MINE, base: BASE, conflicts: [] });
  });

  it('keeps the local body untouched when it already survived a no-op remote row', () => {
    expect(plan({ ...concurrent, remote: BASE, postApply: MINE, serverValue: MINE }))
      .toEqual({ action: 'keep', base: MINE, conflicts: [] });
  });

  it('does not ask for a decision when the remote body already contains the local edit', () => {
    expect(plan({ ...concurrent, remote: MERGED, postApply: MERGED, serverValue: MERGED }))
      .toEqual({ action: 'adopt', base: MERGED, conflicts: [] });
  });

  it('writes the remote body when it contains the local edit but lost locally', () => {
    expect(plan({ ...concurrent, remote: MERGED, postApply: MINE, serverValue: MINE }))
      .toEqual({ action: 'write', content: MERGED, base: MINE, conflicts: [] });
  });

  it('does not ask for a decision when the local body already contains the remote edit', () => {
    expect(plan({ mine: MERGED, localPending: true, postApply: MERGED, serverValue: MERGED }))
      .toEqual({ action: 'keep', base: MERGED, conflicts: [] });
  });

  it('leaves the stored base alone when the server outcome is unknown', () => {
    const result = plan({ ...concurrent, postApply: MINE, serverValue: undefined });
    expect(result.action).toBe('record-conflict');
    expect(result.base).toBeUndefined();
  });

  it('adopts the remote body when a pending upload turns out to equal the base', () => {
    // A re-offered row that was never a real edit.
    expect(plan({ mine: BASE, localPending: true, postApply: REMOTE }))
      .toEqual({ action: 'adopt', base: REMOTE, conflicts: [] });
  });
});

describe('planRemoteContent: without a base', () => {
  it('keeps both bodies when an unacknowledged local edit meets a remote one', () => {
    const result = plan({ hasBase: false, base: undefined, mine: MINE, localPending: true, postApply: REMOTE, serverValue: REMOTE });
    expect(result).toMatchObject({ action: 'record-conflict', reason: 'no-base', base: REMOTE });
    expect(result.conflicts[0].baseLines).toEqual([]);
    expect(result.conflicts[0].mineLines.join('\n')).toBe(MINE);
    expect(result.conflicts[0].theirsLines.join('\n')).toBe(REMOTE);
  });

  it('keeps both bodies when the local value survived although nothing was pending', () => {
    // An edit stranded by the old single-clock upload: not known to be pending,
    // yet it outranks the server's value, so the server never saw it.
    const result = plan({ hasBase: false, base: undefined, mine: MINE, localPending: false, postApply: MINE, serverValue: REMOTE });
    expect(result).toMatchObject({ action: 'record-conflict', reason: 'no-base', base: REMOTE });
  });
});

describe('planRemoteContent: a stranded edit with a known base', () => {
  it('merges instead of silently adopting when the local value survived the remote row', () => {
    const result = plan({ mine: MINE, localPending: false, postApply: MINE, serverValue: REMOTE, capabilityEnabled: true });
    expect(result).toEqual({ action: 'write-merge', content: MERGED, base: REMOTE, conflicts: [] });
  });
});

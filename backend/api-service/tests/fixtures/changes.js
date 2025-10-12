// Sample CRDT changes for testing
export const sampleChanges = [
    {
        table: 'notes',
        pk: '["note-1"]',
        cid: 'title',
        val: '"Test Note"',
        col_version: 1,
        db_version: 1,
        site_id: 'a'.repeat(32), // 16-byte hex string
        cl: 0,
        seq: 1
    },
    {
        table: 'notes',
        pk: '["note-1"]',
        cid: 'content',
        val: '"This is test content"',
        col_version: 1,
        db_version: 2,
        site_id: 'a'.repeat(32),
        cl: 0,
        seq: 2
    }
];

export function createSampleNote(userId) {
    return {
        table: 'notes',
        pk: `["note-${Date.now()}"]`,
        cid: 'title',
        val: '"Sample Note"',
        col_version: 1,
        db_version: 1,
        site_id: 'a'.repeat(32),
        cl: 0,
        seq: 1
    };
}

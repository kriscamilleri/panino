// Load benchmark for the v1 API's reads on a large account. Opt-in: it builds about 70 MB of
// Documents and takes a minute, so it is skipped unless PANINO_PERF=1.
//
//   docker build -q -f backend/api-service/Dockerfile.test -t panino-api-perf .
//   docker run --rm -e PANINO_PERF=1 -e NODE_OPTIONS=--expose-gc panino-api-perf \
//     npx vitest run addons/ai/tests/perf
//
// Each read runs through the REST route three times. The table gives the median time (the
// event loop is blocked for about that long, since the handlers are synchronous) and how far
// the process's peak memory rose during the first run. The peak only grows, so an operation
// that stays under an earlier peak shows 0; the lighter reads run first.
import request from 'supertest';
import { gzipSync } from 'zlib';
import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserDb } from '../../../../db.js';
import { aiUser, createKey, createTestApp, offerAiAddon, resetAiState } from '../aiTestSetup.js';

const V1 = '/addons/ai/v1';
const RUN = process.env.PANINO_PERF === '1';

/** Small seeded PRNG (mulberry32), so every run builds the same account. */
function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore '
    + 'et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea '
    + 'commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur '
    + 'alpha beta gamma quick brown fox report meeting budget plan review draft').split(' ');

function makeBody(rand, targetBytes, { frontMatter, imageIds, rare }) {
    const parts = [];
    if (frontMatter) {
        parts.push('---', `status: ${rand() < 0.5 ? 'draft' : 'final'}`, `priority: ${Math.floor(rand() * 10)}`);
        if (rand() < 0.5) parts.push(`owner: ${rand() < 0.5 ? 'Kris' : 'Sam'}`);
        parts.push(`due: 2026-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-15`, '---', '');
    }
    let size = 0;
    let section = 0;
    while (size < targetBytes) {
        let block;
        const pick = rand();
        if (pick < 0.12) block = `${'#'.repeat(1 + Math.floor(rand() * 3))} Section ${++section} ${WORDS[Math.floor(rand() * WORDS.length)]}`;
        else if (pick < 0.2) block = Array.from({ length: 3 }, () => `- ${WORDS[Math.floor(rand() * WORDS.length)]} item`).join('\n');
        else if (pick < 0.23) block = '```js\nconst x = 1;\n# not a heading\n```';
        else {
            const words = Array.from({ length: 40 + Math.floor(rand() * 80) }, () => WORDS[Math.floor(rand() * WORDS.length)]);
            if (rand() < 0.05) words.push('Über');
            block = words.join(' ');
        }
        parts.push(block, '');
        size += block.length + 2;
    }
    if (rare) parts.push('A zebra appears.', '');
    for (const id of imageIds) parts.push(`![figure](/api/images/${id})`, '');
    return parts.join('\n');
}

describe.skipIf(!RUN)('v1 API load on a large account', () => {
    let app;
    let server;
    let restore;
    let user;
    let secret;
    const results = [];
    const ids = {};

    beforeAll(async () => {
        restore = offerAiAddon();
        ({ app, server } = createTestApp());
        resetAiState();
        process.env.API_RATE_LIMIT_PER_MINUTE = '100000';
        user = await aiUser('perf');
        ({ secret } = await createKey(app, user, { name: 'Bench agent' }));

        const db = getUserDb(user.userId);
        const rand = random(20261108);
        const started = performance.now();
        const folders = [];
        db.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)')
            .run('f-trash', user.userId, 'Trash', null, '2026-01-01T00:00:00.000Z');
        for (let i = 0; i < 40; i += 1) {
            const id = `f-${i}`;
            const parent = i >= 10 ? `f-${i % 10}` : null;
            db.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(id, user.userId, `Folder ${i}`, parent, '2026-01-01T00:00:00.000Z');
            folders.push(id);
        }
        const imageIds = Array.from({ length: 300 }, () => crypto.randomUUID());
        const insertImage = db.prepare('INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        imageIds.forEach((id, i) => insertImage.run(id, user.userId, `image-${i}.png`, 'image/png', `${id}.png`, 1000 + i, '', `2026-02-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00.000Z`));
        ids.image = imageIds[0];

        const insertNote = db.prepare(`INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
                                       VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const insertRevision = db.prepare(`INSERT INTO note_revisions (id, note_id, title, content_gzip, type, content_sha256,
                                           uncompressed_bytes, compressed_bytes, created_at, actor_user_id, actor_kind, actor_label)
                                           VALUES (?, ?, ?, ?, 'auto', ?, ?, ?, ?, ?, ?, ?)`);
        let totalBytes = 0;
        db.transaction(() => {
            for (let i = 0; i < 5000; i += 1) {
                const id = `n-${String(i).padStart(5, '0')}`;
                const roll = rand();
                const targetBytes = i < 100 ? 250_000 + rand() * 100_000 : roll < 0.18 ? 20_000 + rand() * 40_000 : 1_500 + rand() * 6_000;
                const refs = rand() < 0.1 ? [imageIds[Math.floor(rand() * imageIds.length)], imageIds[0]] : [];
                const body = makeBody(rand, targetBytes, { frontMatter: rand() < 0.33, imageIds: refs, rare: i % 500 === 7 });
                totalBytes += body.length;
                const folder = i >= 4900 ? 'f-trash' : rand() < 0.2 ? null : folders[Math.floor(rand() * folders.length)];
                const day = (k) => new Date(Date.UTC(2026, 0, 1) + k * 3_600_000).toISOString();
                const created = day(i);
                const updated = day(i + Math.floor(rand() * 5000));
                insertNote.run(id, user.userId, folder, `Document ${i} ${WORDS[i % WORDS.length]}`, body, created, updated);
                const gz = gzipSync('revision body');
                for (let r = 0; r < 10; r += 1) {
                    const api = r === 9 && rand() < 0.3;
                    insertRevision.run(`${id}-r${r}`, id, `Document ${i}`, gz, 'x', 13, gz.length, day(i + r),
                        user.userId, api ? 'api' : r === 0 ? null : 'sync', api ? 'Bench agent' : null);
                }
            }
            // One 2 MiB Document with many headings, for outline and section reads.
            const big = makeBody(rand, 2_000_000, { frontMatter: true, imageIds: [] });
            insertNote.run('n-big', user.userId, null, 'Big', big, day0(), day0());
            totalBytes += big.length;
            const insertTemplate = db.prepare('INSERT INTO templates (id, name, content, title_pattern, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
            for (let t = 0; t < 20; t += 1) insertTemplate.run(`t-${t}`, `Template ${t}`, `# {{input:Title}}\n\n![x](/api/images/${imageIds[t]})`, '', day0(), day0());
        })();
        function day0() { return '2026-03-01T00:00:00.000Z'; }
        ids.document = 'n-00150';
        ids.big = 'n-big';
        const firstRevisions = db.prepare("SELECT id FROM note_revisions WHERE note_id = ? ORDER BY created_at LIMIT 2").all(ids.document);
        ids.revisionA = firstRevisions[0].id;
        ids.revisionB = firstRevisions[1].id;
        console.log(`[perf] built ${(totalBytes / 1e6).toFixed(1)} MB in 5001 Documents, 50000 revisions in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    }, 600_000);

    afterAll(async () => {
        if (results.length) {
            const lines = results.map((r) => `${r.label.padEnd(44)} ${r.median.toFixed(1).padStart(9)} ms ${r.peakGrowthMb.toFixed(1).padStart(8)} MB  ${r.note}`);
            console.log(['[perf] operation                                   median     peak+', ...lines].join('\n'));
        }
        restore?.();
        user?.cleanup();
        if (server) await new Promise((resolve) => server.close(resolve));
    });

    async function measure(label, path, check = (body) => body) {
        const times = [];
        let note = '';
        let peakGrowthMb = 0;
        for (let run = 0; run < 3; run += 1) {
            global.gc?.();
            const peakBefore = process.resourceUsage().maxRSS;
            const started = performance.now();
            const res = await request(app).get(`${V1}${path}`).set('Authorization', `Bearer ${secret}`);
            times.push(performance.now() - started);
            if (run === 0) peakGrowthMb = (process.resourceUsage().maxRSS - peakBefore) / 1024;
            expect(res.status, `${label}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
            note = check(res.body) ?? '';
        }
        times.sort((a, b) => a - b);
        results.push({ label, median: times[1], peakGrowthMb, note: String(note) });
    }

    const q = encodeURIComponent;
    it('reads', async () => {
        await measure('tree', '/tree', (b) => `${b.tree?.documentCount ?? ''}`);
        await measure('list documents (50, updated)', '/documents?limit=50', (b) => `${b.documents.length}`);
        await measure('list documents (200, title)', '/documents?limit=200&sort=title', (b) => `${b.documents.length}`);
        await measure('get document properties', `/documents/${ids.document}/properties`, (b) => `words ${b.builtIn.wordCount}`);
        let middle = '';
        await measure('outline of 2 MiB Document', `/documents/${ids.big}/outline`, (b) => {
            const headings = b.headings ?? b.outline ?? [];
            middle = headings[Math.floor(headings.length / 2)]?.slug ?? '';
            return `${headings.length} headings`;
        });
        await measure('section of 2 MiB Document', `/documents/${ids.big}?section=${q(middle)}`, (b) => `lines ${b.document.range?.startLine}-${b.document.range?.endLine}`);
        await measure('revisions list', `/documents/${ids.document}/revisions`, (b) => `${b.revisions.length}`);
        await measure('revision diff', `/documents/${ids.document}/revisions/${ids.revisionB}/diff?against=${ids.revisionA}`, () => '');
        await measure('trash', '/trash', (b) => `${(b.documents ?? b.items ?? []).length}`);
        await measure('templates', '/templates', (b) => `${b.templates.length}`);
        await measure('search "zebra" (rare)', `/search?q=zebra`, (b) => `${b.results.length}`);
        await measure('search "lorem" (common)', `/search?q=lorem`, (b) => `${b.results.length}`);
        await measure('search 3 words', `/search?q=${q('alpha beta gamma')}`, (b) => `${b.results.length}`);
        await measure('search phrase', `/search?q=${q('"quick brown"')}`, (b) => `${b.results.length}`);
        await measure('search "über" (non-ASCII)', `/search?q=${q('über')}`, (b) => `${b.results.length}`);
        await measure('image usage', `/images/${ids.image}/usage`, (b) => `${b.usageCount}`);
        await measure('list images (50)', '/images?limit=50', (b) => `${b.images.length}`);
        await measure('list images (200)', '/images?limit=200', (b) => `${b.images.length}`);
        await measure('property keys', '/properties', (b) => `${b.keys.length} keys, ${b.documentsWithProperties} docs`);
        await measure('query status = draft', `/properties/query?filter=${q('status = draft')}`, (b) => `${b.total}`);
        await measure('query owner missing', `/properties/query?filter=${q('owner missing')}`, (b) => `${b.total}`);
        await measure('query modified_on >= 2026-06-01', `/properties/query?filter=${q('modified_on >= 2026-06-01')}`, (b) => `${b.total}`);
        await measure('query modified_by = Bench agent', `/properties/query?filter=${q('modified_by = Bench agent')}`, (b) => `${b.total}`);
        await measure('query status = draft AND word_count > 2000', `/properties/query?filter=${q('status = draft AND word_count > 2000')}`, (b) => `${b.total}`);
        await measure('query word_count >= 1000', `/properties/query?filter=${q('word_count >= 1000')}`, (b) => `${b.total}`);
    }, 600_000);
});

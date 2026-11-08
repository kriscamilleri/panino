/**
 * Development-only console helpers for phase 0 of docs/specs/active/advanced-search.md
 * (§8): time `docStore.searchDocuments` in the browser, and seed a dev account with
 * the API's benchmark generator. `main.js` installs them only when
 * `import.meta.env.DEV`, so production builds leave this module out.
 *
 *   await __paninoSearchBench('lorem')              // median of 5 runs
 *   await __paninoSearchBench('über', 5, { limit: 20 })
 *   await __paninoSearchSeed({ count: 5000, confirm: true })   // writes and syncs!
 *
 * For the throttled run, set CPU throttling to 4x in DevTools (Performance panel)
 * before calling the bench.
 */
import { pinia } from '@/pinia';
import { useDocStore } from '@/store/docStore';
import { useSyncStore } from '@/store/syncStore';
import { useAuthStore } from '@/store/authStore';

/** Small seeded PRNG (mulberry32), the one the API's load test uses. */
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

// The words and body shapes of backend/api-service/addons/ai/tests/perf/load.perf.test.js.
const WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore '
    + 'et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea '
    + 'commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur '
    + 'alpha beta gamma quick brown fox report meeting budget plan review draft').split(' ');

function makeBody(rand, targetBytes, { frontMatter, rare }) {
    const parts = [];
    if (frontMatter) {
        parts.push('---', `status: ${rand() < 0.5 ? 'draft' : 'final'}`, `priority: ${Math.floor(rand() * 10)}`);
        if (rand() < 0.5) parts.push(`owner: ${rand() < 0.5 ? 'Kris' : 'Sam'}`);
        // Tags without drawing from the generator: every front matter block has `report`, and
        // those with priority 0 or 7 (about one in five) also `alpha`, for the tag: rows.
        parts.push(`tags: [report${parts[2] === 'priority: 0' || parts[2] === 'priority: 7' ? ', alpha' : ''}]`);
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
            // A link in two of three paragraphs, without drawing from the generator (so the
            // account is otherwise the same): brackets in most bodies, as real notes have, so
            // `is:checklist` has to run its checklist rule on them.
            if (words.length % 3 !== 0) words.push('see [the notes](https://example.test/notes)');
            block = words.join(' ');
        }
        parts.push(block, '');
        size += block.length + 2;
    }
    if (rare) parts.push('A zebra appears.', '');
    return parts.join('\n');
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Time one query: `runs` searches one after another, first page only.
 *
 * @param {string} query
 * @param {number} [runs]
 * @param {{ limit?: number, page2?: boolean }} [options] `page2` also times the next page
 * @returns {Promise<object>} median and every time in ms, result count, databases
 */
export async function searchBench(query, runs = 5, { limit = 20, page2 = false } = {}) {
    const docStore = useDocStore(pinia);
    const syncStore = useSyncStore(pinia);
    const times = [];
    const nextTimes = [];
    let found = null;
    for (let run = 0; run < runs; run += 1) {
        const started = performance.now();
        found = await docStore.searchDocuments({ query, limit });
        times.push(performance.now() - started);
        if (page2 && found.nextCursor) {
            const next = performance.now();
            await docStore.searchDocuments({ query, limit, cursor: found.nextCursor });
            nextTimes.push(performance.now() - next);
        }
    }
    let documents = 0;
    for (const entry of syncStore.databases.values()) {
        if (!entry.db) continue;
        const [row] = await syncStore.repository(entry.dbKey).execute('SELECT count(*) AS n FROM notes');
        documents += Number(row?.n ?? 0);
    }
    const summary = {
        query,
        runs,
        medianMs: Math.round(median(times) * 10) / 10,
        timesMs: times.map((time) => Math.round(time * 10) / 10),
        ...(nextTimes.length ? { page2MedianMs: Math.round(median(nextTimes) * 10) / 10 } : {}),
        results: found?.results.length ?? 0,
        more: Boolean(found?.nextCursor),
        notices: found?.notices ?? [],
        databases: [...syncStore.databases.values()].filter((entry) => entry.db).length,
        documents,
        userAgent: navigator.userAgent,
    };
    // A dev console helper: the table is its output.
    // eslint-disable-next-line no-console
    console.table([summary]);
    return summary;
}

/**
 * Seed the personal database with the API's benchmark Documents (same generator and seed:
 * 100 large, 18% medium, the rest small; a third with front matter; a few "zebra" and
 * "Über"). The Documents are real and sync to the server, so use a throwaway dev account.
 *
 * @param {{ count?: number, confirm?: boolean }} [options]
 * @returns {Promise<{ inserted: number, megabytes: number, ms: number }>}
 */
export async function searchSeed({ count = 5000, confirm = false } = {}) {
    if (!confirm) throw new Error('This writes Documents that sync to the server. Call with { confirm: true } on a throwaway dev account.');
    const syncStore = useSyncStore(pinia);
    const authStore = useAuthStore(pinia);
    const dbKey = syncStore.personalDbKey;
    if (!dbKey || !authStore.user?.id) throw new Error('Sign in first.');
    const rand = random(20261108);
    const started = performance.now();
    let bytes = 0;
    const batch = 250;
    for (let start = 0; start < count; start += batch) {
        await syncStore.repository(dbKey).transaction(async (repo) => {
            for (let i = start; i < Math.min(count, start + batch); i += 1) {
                const roll = rand();
                const targetBytes = i < 100 ? 250_000 + rand() * 100_000 : roll < 0.18 ? 20_000 + rand() * 40_000 : 1_500 + rand() * 6_000;
                const body = makeBody(rand, targetBytes, { frontMatter: rand() < 0.33, rare: i % 500 === 7 });
                bytes += body.length;
                const day = (k) => new Date(Date.UTC(2026, 0, 1) + k * 3_600_000).toISOString();
                await repo.exec(
                    'INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [crypto.randomUUID(), authStore.user.id, null, `Bench ${i} ${WORDS[i % WORDS.length]}`, body, day(i), day(i + Math.floor(rand() * 5000))],
                );
            }
        });
    }
    const summary = { inserted: count, megabytes: Math.round(bytes / 1e5) / 10, ms: Math.round(performance.now() - started) };
    console.info('[search bench] seeded', summary);
    return summary;
}

/** Put the helpers on `window`. Development builds only (see main.js). */
export function installSearchBench() {
    window.__paninoSearchBench = searchBench;
    window.__paninoSearchSeed = searchSeed;
}

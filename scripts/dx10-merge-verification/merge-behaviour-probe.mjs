/**
 * DX-10 §6 Phase 2 step 8 — merge-behaviour probe.
 *
 * Runs a fixed, deterministic sequence of CR-SQLite operations against ONE database file and
 * prints a JSON report. The point is not the report on its own: it is that the same report,
 * produced on a better-sqlite3 9.6.0 build (SQLite 3.45.3) and on a 12.11.1 build
 * (SQLite 3.53.2), can be diffed. The spec calls this "the real gate" precisely because a
 * green unit suite does not exercise the crsql_changes paths that failed in June and July.
 *
 * This MUTATES the database it is given. The runner always hands it a copy.
 *
 * Determinism matters more than realism here — every id, timestamp and site id below is
 * fixed, so any difference between the two arms is attributable to the stack, not to the
 * probe. The one thing that legitimately differs is `sqlite_version`.
 *
 * Usage:  node merge-behaviour-probe.mjs <database-path>
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function loadDatabaseDriver() {
  const candidates = [
    () => require("better-sqlite3"),
    () => createRequire(path.join(process.cwd(), "package.json"))("better-sqlite3"),
  ];
  for (const candidate of candidates) {
    try {
      return candidate();
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error("Could not resolve better-sqlite3 for the merge probe");
}

function resolveCrsqlitePath() {
  const fromEnv = process.env.CRSQLITE_EXT_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  throw new Error("Set CRSQLITE_EXT_PATH to the crsqlite shared object");
}

// --- Fixed inputs -----------------------------------------------------------------------
// A remote site id distinct from whatever the database already carries, so the changes below
// are treated as incoming rather than filtered as local echoes.
const REMOTE_SITE_ID = Buffer.from("d0d0cafe000000000000000000000001", "hex");
const PROBE_NOTE_ID = "dx10-probe-note-0000-0000-00000001";
const PROBE_IMAGE_ID = "dx10-probe-image-0000-0000-0000001";
const PROBE_FOLDER_ID = "dx10-probe-folder-0000-0000-000001";
const FIXED_TIMESTAMP = "2026-08-16T00:00:00.000Z";

/** Row counts per CR-SQLite clock table, plus the sentinel/non-sentinel split. */
function clockSnapshot(db) {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE '%__crsql_clock'
        ORDER BY name`,
    )
    .all()
    .map((row) => row.name);

  const snapshot = {};
  for (const table of tables) {
    const total = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
    const sentinels = db
      .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE col_name = '-1'`)
      .get().n;
    snapshot[table] = { total, sentinels, nonSentinels: total - sentinels };
  }
  return snapshot;
}

/**
 * Count clock rows for one business id, split by sentinel.
 *
 * The clock table keys on an integer that indexes `<table>__crsql_pks`, not on the business
 * id — this is the `key 216` indirection the July incident report describes — so reaching a
 * specific row means joining through the pks table.
 */
function clockRowsFor(db, table, id) {
  const count = (predicate) =>
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM "${table}__crsql_clock" k
           JOIN "${table}__crsql_pks" p ON p.__crsql_key = k.key
          WHERE p.id = ? AND k.col_name ${predicate} '-1'`,
      )
      .get(id).n;
  return { sentinelRows: count("="), nonSentinelRows: count("!=") };
}

function state(db, label) {
  return {
    label,
    dbVersion: Number(db.prepare("SELECT crsql_db_version() AS v").get().v),
    syncBit: Number(db.prepare("SELECT crsql_internal_sync_bit() AS b").get().b),
    clocks: clockSnapshot(db),
    changeRows: db.prepare("SELECT COUNT(*) AS n FROM crsql_changes").get().n,
  };
}

/**
 * Apply a batch of incoming changes the way sync.js does: primary keys packed via
 * crsql_pack_columns, one transaction, fail closed. The `pk` column is CR-SQLite's packed
 * binary format — handing it a quoted SQL string aborts the statement.
 */
function applyChanges(db, changes) {
  const insert = db.prepare(
    `INSERT INTO crsql_changes
       ("table", pk, cid, val, col_version, db_version, site_id, cl, seq)
     VALUES (@table, @pk, @cid, @val, @col_version, @db_version, @site_id, @cl, @seq)`,
  );
  const pack = db.prepare("SELECT crsql_pack_columns(?) AS pk");
  const run = db.transaction((batch) => {
    for (const entry of batch) {
      insert.run({ ...entry, pk: pack.get(entry.pk).pk });
    }
  });
  run(changes);
}

function change(table, pk, cid, val, colVersion, dbVersion, seq, cl = 1) {
  return {
    table,
    pk,
    cid,
    val,
    col_version: colVersion,
    db_version: dbVersion,
    site_id: REMOTE_SITE_ID,
    cl,
    seq,
  };
}

function main() {
  const dbPath = process.argv[2];
  if (!dbPath) throw new Error("usage: merge-behaviour-probe.mjs <database-path>");

  const Database = loadDatabaseDriver();
  const db = new Database(dbPath);
  db.loadExtension(resolveCrsqlitePath());
  db.pragma("journal_mode = wal");

  const report = {
    sqliteVersion: db.prepare("SELECT sqlite_version() AS v").get().v,
    betterSqlite3Version:
      require("better-sqlite3/package.json").version ?? "unknown",
    steps: [],
    errors: [],
  };

  try {
    report.before = state(db, "before");

    // --- Step 8a: pull. Reading changes since 0 is what every client sync starts with.
    const pulled = db
      .prepare("SELECT COUNT(*) AS n FROM crsql_changes WHERE db_version > 0")
      .get().n;
    report.steps.push({ step: "pull-changes-since-0", rowsVisible: pulled });

    // --- Step 8b: push. Insert a note from a remote site, then update it — the ordinary
    // round trip. A failure here surfaces as "could not find row to merge with".
    const baseVersion = report.before.dbVersion + 1;
    applyChanges(db, [
      change("folders", PROBE_FOLDER_ID, "name", "DX10 Probe", 1, baseVersion, 1),
      change("notes", PROBE_NOTE_ID, "title", "DX10 Probe Note", 1, baseVersion, 2),
      change("notes", PROBE_NOTE_ID, "content", "# probe", 1, baseVersion, 3),
      change("notes", PROBE_NOTE_ID, "created_at", FIXED_TIMESTAMP, 1, baseVersion, 4),
      change("notes", PROBE_NOTE_ID, "updated_at", FIXED_TIMESTAMP, 1, baseVersion, 5),
    ]);
    const noteInserted = db
      .prepare("SELECT COUNT(*) AS n FROM notes WHERE id = ?")
      .get(PROBE_NOTE_ID).n;
    report.steps.push({ step: "merge-insert-note", noteRows: noteInserted });

    applyChanges(db, [
      change("notes", PROBE_NOTE_ID, "title", "DX10 Probe Note (edited)", 2, baseVersion + 1, 1),
    ]);
    report.steps.push({
      step: "merge-update-note",
      title: db.prepare("SELECT title FROM notes WHERE id = ?").get(PROBE_NOTE_ID)?.title,
    });

    // --- Step 8c: local edit pushed back out. A local write must produce clock rows under
    // the local site id, which is how the client learns about it on the next pull.
    const versionBeforeLocalEdit = Number(
      db.prepare("SELECT crsql_db_version() AS v").get().v,
    );
    db.prepare("UPDATE notes SET content = ? WHERE id = ?").run(
      "# probe (local edit)",
      PROBE_NOTE_ID,
    );
    report.steps.push({
      step: "local-edit",
      dbVersionAdvanced:
        Number(db.prepare("SELECT crsql_db_version() AS v").get().v) >
        versionBeforeLocalEdit,
    });

    // --- Step 8d: image-clock write. The June/July incidents both ended here: an image row
    // deleted without a sentinel left orphan clock rows that broke the next merge.
    db.prepare(
      `INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      PROBE_IMAGE_ID,
      "dx10-probe-user",
      "probe.png",
      "image/png",
      "dx10-probe-storage.png",
      1234,
      "0".repeat(64),
      FIXED_TIMESTAMP,
    );
    report.steps.push({
      step: "image-insert",
      ...clockRowsFor(db, "images", PROBE_IMAGE_ID),
    });

    // --- Step 8e: note delete, the documented tombstone surface. Must leave a `-1` sentinel
    // and no orphan non-sentinel clock rows.
    db.prepare("DELETE FROM notes WHERE id = ?").run(PROBE_NOTE_ID);
    report.steps.push({
      step: "note-delete",
      ...clockRowsFor(db, "notes", PROBE_NOTE_ID),
      baseRowGone:
        db.prepare("SELECT COUNT(*) AS n FROM notes WHERE id = ?").get(PROBE_NOTE_ID).n === 0,
    });

    // --- Step 8f: image delete, same surface, the table that actually broke.
    db.prepare("DELETE FROM images WHERE id = ?").run(PROBE_IMAGE_ID);
    report.steps.push({
      step: "image-delete",
      ...clockRowsFor(db, "images", PROBE_IMAGE_ID),
    });

    report.after = state(db, "after");
    report.dbVersionDelta = report.after.dbVersion - report.before.dbVersion;
  } catch (error) {
    // A thrown merge is itself a result worth comparing between arms, so it is recorded
    // rather than allowed to kill the run.
    report.errors.push({ message: error.message, code: error.code ?? null });
    try {
      report.after = state(db, "after-error");
    } catch {
      report.after = null;
    }
  } finally {
    db.close();
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.errors.length > 0 ? 1 : 0;
}

main();

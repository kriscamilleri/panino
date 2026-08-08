// backend/api-service/scripts/repair-orphan-image-clocks.mjs
//
// One-off repair script for the production sync 500 incident (2026-07-06).
//
// Background: see docs/agent-logs/2026/07/2026-07-06_17-00_fix-sync-could-not-find-row.md
// and db-repair.js. In short, CR-SQLite emits
//   "could not find row to merge with for tbl images"
// when `images__crsql_clock` has non-sentinel rows for a primary key whose
// live `images` row is already gone and no deletion sentinel was written.
// Once that state exists, every subsequent /sync request returns 500 and
// the client can never advance its clock.
//
// This script removes those orphan clock rows from every user DB (or a
// single --user) so the next client /sync merges the (re-sent) image INSERT
// cleanly via crsqlite's resurrect path.
//
// Usage:
//
//   # Always dry-run first.
//   node scripts/repair-orphan-image-clocks.mjs
//
//   # Apply the actual DELETEs.
//   node scripts/repair-orphan-image-clocks.mjs --apply
//
//   # Limit to one user.
//   node scripts/repair-orphan-image-clocks.mjs --apply --user <userId>
//
//   # Override DB dir / crsqlite ext path.
//   DB_DIR=/app/data node scripts/repair-orphan-image-clocks.mjs --apply
//
// Notes:
//   - Default DB dir is `process.env.DB_DIR` or `./data`.
//   - The script MUTATES the database; back up /app/data before running
//     with --apply in production.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import {
  findOrphanImagesClockRows,
  repairOrphanImagesClocks,
} from "../db-repair.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const applyFlag = argv.includes("--apply");
const userArgIdx = argv.indexOf("--user");
const userArg =
  userArgIdx !== -1 && argv[userArgIdx + 1] ? argv[userArgIdx + 1] : null;
const dbDir = process.env.DB_DIR || path.join(__dirname, "..", "data");

// Resolve the crsqlite extension so the script drives schema identically to
// the running api-service. Honestly the repair only touches plain
// `images__crsql_clock` rows so the extension is optional, but loading it
// keeps behavior consistent with the live app.
let crsqliteExtPath = process.env.CRSQLITE_EXT_PATH || null;
if (!crsqliteExtPath) {
  try {
    const pkgDir = path.dirname(
      require.resolve("@vlcn.io/crsqlite/package.json"),
    );
    const walk = (dir) => {
      const out = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(p));
        else out.push(p);
      }
      return out;
    };
    const candidates = walk(pkgDir).filter((p) =>
      /crsqlite\.(node|so|dylib|dll)$/.test(p),
    );
    const release = candidates.find((p) => /build\/Release\//.test(p));
    crsqliteExtPath = release || candidates[0] || null;
  } catch {
    /* ignore */
  }
}

if (!fs.existsSync(dbDir)) {
  console.error(`DB dir does not exist: ${dbDir}`);
  process.exit(2);
}

const sanitizeUserArg = (s) => (s.endsWith(".db") ? s.slice(0, -3) : s);
const targetUser = userArg ? sanitizeUserArg(userArg) : null;
const files = fs
  .readdirSync(dbDir)
  .filter(
    (f) =>
      f.endsWith(".db") &&
      f !== "_users.db" &&
      (!targetUser || f === `${targetUser}.db` || f === targetUser),
  );

if (!files.length) {
  console.error(
    targetUser
      ? `No user DB matched --user ${userArg} in ${dbDir}`
      : `No user DBs found in ${dbDir}`,
  );
  process.exit(2);
}

console.log(
  `repair-orphan-image-clocks: ${applyFlag ? "APPLY" : "DRY-RUN"}, ` +
    `${files.length} DB(s)${targetUser ? ` (filtered to ${targetUser})` : ""}`,
);
if (crsqliteExtPath) console.log(`  crsqlite ext: ${crsqliteExtPath}`);
else console.log("  crsqlite ext: NOT FOUND (proceeding without loading it)");

let totalRemoved = 0;
let totalOrphans = 0;
let dbsAffected = 0;
let failures = 0;

for (const f of files) {
  const dbPath = path.join(dbDir, f);
  let db;
  try {
    db = new Database(dbPath, { fileMustExist: true });
    if (crsqliteExtPath) {
      try {
        db.loadExtension(crsqliteExtPath);
      } catch (e) {
        console.warn(`  ${f}: failed to load crsqlite ext: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(`  ${f}: cannot open (${e.message})`);
    failures += 1;
    if (db) db.close();
    continue;
  }

  try {
    const hasImages = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='images'",
      )
      .get();
    if (!hasImages) {
      db.close();
      continue;
    }

    const orphans = findOrphanImagesClockRows(db);
    if (!orphans.length) {
      db.close();
      continue;
    }

    dbsAffected += 1;
    totalOrphans += orphans.length;
    const pkGroups = new Set(orphans.map((o) => o.pk_id || "(null)"));
    console.log(
      `  ${f}: ${orphans.length} orphan clock row(s) across ${pkGroups.size} image row(s)`,
    );
    for (const o of orphans.slice(0, 15)) {
      console.log(
        `    key=${o.key} pk_id=${o.pk_id || "(null)"} col=${o.col_name} ` +
          `cv=${o.col_version} dbv=${o.db_version} site=${o.site_id_hex || ""}`,
      );
    }
    if (orphans.length > 15) {
      console.log(`    ... and ${orphans.length - 15} more`);
    }

    if (!applyFlag) {
      console.log(`    (dry-run — no rows removed)`);
      db.close();
      continue;
    }

    const result = repairOrphanImagesClocks(db, { apply: true });
    totalRemoved += result.removed;
    console.log(`    removed ${result.removed} clock row(s)`);
    db.close();
  } catch (e) {
    console.error(`  ${f}: error during repair (${e.message})`);
    failures += 1;
    try {
      db.close();
    } catch (_) {
      /* ignore */
    }
  }
}

console.log("==== SUMMARY ====");
console.log(`DBs with orphans: ${dbsAffected}`);
console.log(`Orphan clock rows discovered: ${totalOrphans}`);
console.log(
  `Clock rows ${applyFlag ? "removed" : "would-remove"}: ${applyFlag ? totalRemoved : totalOrphans}`,
);
if (!applyFlag) console.log("Run with --apply to actually delete them.");
if (failures > 0) {
  console.error(`Repair completed with ${failures} database error(s).`);
  process.exitCode = 1;
}

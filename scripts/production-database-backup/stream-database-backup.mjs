import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

// better-sqlite3 lives with the backend, not with this script. Resolve it from wherever it
// is actually reachable: next to the script, next to the process (in production this file is
// piped into `node` inside the api-service container, so cwd carries the dependency), or via
// the backend package in a repo checkout. Each candidate is tried in turn so the script works
// unchanged when streamed into the container, run from the repo, or loaded by the test suite.
const moduleResolvers = [
  () => createRequire(import.meta.url),
  () => createRequire(path.join(process.cwd(), "package.json")),
  () => createRequire(new URL("../../backend/api-service/package.json", import.meta.url)),
];

let Database;
let lastResolveError;
for (const makeRequire of moduleResolvers) {
  try {
    Database = makeRequire()("better-sqlite3");
    break;
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    lastResolveError = error;
  }
}
if (!Database) {
  throw new Error("Could not resolve better-sqlite3 for the backup producer", {
    cause: lastResolveError,
  });
}

const TAR_BLOCK_SIZE = 512;

function writeString(buffer, offset, length, value) {
  buffer.write(value, offset, length, "ascii");
}

function writeOctal(buffer, offset, length, value) {
  const encoded = Math.floor(value).toString(8).padStart(length - 1, "0");
  if (encoded.length >= length) {
    throw new Error(`Tar field value ${value} exceeds ${length - 1} octal digits`);
  }
  writeString(buffer, offset, length, `${encoded}\0`);
}

/** Create a POSIX ustar header for one database snapshot. */
export function createTarHeader(name, size, modifiedAtSeconds) {
  if (!name || Buffer.byteLength(name, "utf8") > 100 || name.includes("/")) {
    throw new Error(`Unsupported archive entry name: ${name}`);
  }

  const header = Buffer.alloc(TAR_BLOCK_SIZE);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o600);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, modifiedAtSeconds);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, "0");
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "panino");
  writeString(header, 297, 32, "panino");

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

/**
 * Parse a comma-separated database selector into a Set of bare filenames.
 *
 * Entries are matched against the filename only. A `.db` suffix is optional, and any entry
 * containing a path separator is rejected rather than normalised — a selector is a name, and
 * silently accepting `../` would let a caller reach outside the database directory.
 */
export function parseDatabaseSelector(value) {
  if (!value) return null;
  const names = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes("/") || entry.includes("\\") || entry === "..") {
        throw new Error(`Database selector entries must be plain filenames: ${entry}`);
      }
      return entry.endsWith(".db") ? entry : `${entry}.db`;
    });
  return names.length > 0 ? new Set(names) : null;
}

/**
 * Return regular SQLite database files in stable archive order.
 *
 * A full backup takes everything, which is the default and the point. `include`/`exclude`
 * exist for the narrower jobs — notably DX-10 §6 Phase 2 step 8, which needs exactly one
 * user database and has no business pulling `_users.db` (auth data, and not a CRR database,
 * so it carries risk without evidence).
 */
export function listDatabaseFiles(dbDir, { include = null, exclude = null } = {}) {
  const present = fs
    .readdirSync(dbDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".db"))
    .map((entry) => entry.name)
    .sort();

  // Validate include against what exists on disk, before exclude narrows the list — otherwise
  // excluding something you also named in include reads as a missing database.
  if (include) {
    const missing = [...include].filter((name) => !present.includes(name));
    if (missing.length > 0) {
      throw new Error(`Requested database not found: ${missing.join(", ")}`);
    }
  }

  return present
    .filter((name) => (include ? include.has(name) : true))
    .filter((name) => (exclude ? !exclude.has(name) : true));
}

function databaseLabel(name, index, total) {
  return name === "_users.db"
    ? "authentication database"
    : `user database ${index}/${total}`;
}

/** Write operator-friendly progress to stderr without mixing it into archive stdout. */
export function createProgressReporter(output = process.stderr) {
  return ({ stage, label, percent, bytes }) => {
    const size =
      bytes === undefined ? "" : ` (${bytes.toLocaleString("en-US")} bytes)`;
    if (stage === "snapshot-start") {
      output.write(`[backup] ${label}: creating online snapshot\n`);
    } else if (stage === "snapshot-ready") {
      output.write(`[backup] ${label}: snapshot ready${size}\n`);
    } else if (stage === "transfer") {
      output.write(`[transfer] ${label}: ${percent}%${size}\n`);
    } else if (stage === "complete") {
      output.write(`[backup] ${label}: complete\n`);
    }
  };
}

/** Yield a tar archive containing a consistent online snapshot of every database. */
export async function* createDatabaseTar(
  dbDir,
  snapshotRoot = "/dev/shm",
  reportProgress = () => {},
  selection = {},
) {
  const databaseFiles = listDatabaseFiles(dbDir, selection);
  if (databaseFiles.length === 0) {
    throw new Error(`No database files found in ${dbDir}`);
  }
  const userDatabaseCount = databaseFiles.filter(
    (name) => name !== "_users.db",
  ).length;
  let userDatabaseIndex = 0;

  const snapshotDir = fs.mkdtempSync(
    path.join(snapshotRoot, "panino-db-backup-"),
  );

  try {
    for (const name of databaseFiles) {
      const dbPath = path.join(dbDir, name);
      const snapshotPath = path.join(snapshotDir, name);
      if (name !== "_users.db") userDatabaseIndex += 1;
      const label = databaseLabel(
        name,
        userDatabaseIndex,
        userDatabaseCount,
      );
      reportProgress({ stage: "snapshot-start", label });
      const db = new Database(dbPath, {
        readonly: true,
        fileMustExist: true,
        timeout: 30_000,
      });

      try {
        const requiredBytes =
          db.pragma("page_count", { simple: true }) *
          db.pragma("page_size", { simple: true });
        const { bavail, bsize } = fs.statfsSync(snapshotDir);
        const availableBytes = bavail * bsize;
        if (requiredBytes > availableBytes) {
          throw new Error(
            `${snapshotRoot} has ${availableBytes} bytes available; ` +
              `${name} needs at least ${requiredBytes} bytes`,
          );
        }
        await db.backup(snapshotPath);
      } finally {
        db.close();
      }

      try {
        const stat = fs.statSync(snapshotPath);
        reportProgress({ stage: "snapshot-ready", label, bytes: stat.size });
        yield createTarHeader(name, stat.size, stat.mtimeMs / 1000);
        let transferredBytes = 0;
        let reportedPercent = -1;
        for await (const chunk of fs.createReadStream(snapshotPath)) {
          yield chunk;
          transferredBytes += chunk.length;
          const percent = Math.min(
            100,
            Math.floor((transferredBytes / stat.size) * 10) * 10,
          );
          if (percent !== reportedPercent) {
            reportProgress({
              stage: "transfer",
              label,
              percent,
              bytes: transferredBytes,
            });
            reportedPercent = percent;
          }
        }

        const paddingLength =
          (TAR_BLOCK_SIZE - (stat.size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
        if (paddingLength > 0) {
          yield Buffer.alloc(paddingLength);
        }
        reportProgress({ stage: "complete", label });
      } finally {
        fs.rmSync(snapshotPath, { force: true });
      }
    }

    yield Buffer.alloc(TAR_BLOCK_SIZE * 2);
  } finally {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
}

/** Stream a gzip-compressed database tar archive without creating a snapshot file. */
export async function streamDatabaseBackup(dbDir, output = process.stdout) {
  const snapshotRoot = process.env.PANINO_BACKUP_TMP_DIR || "/dev/shm";
  const reportProgress =
    process.env.PANINO_BACKUP_PROGRESS === "1"
      ? createProgressReporter()
      : () => {};
  const selection = {
    include: parseDatabaseSelector(process.env.PANINO_BACKUP_INCLUDE),
    exclude: parseDatabaseSelector(process.env.PANINO_BACKUP_EXCLUDE),
  };
  await pipeline(
    Readable.from(createDatabaseTar(dbDir, snapshotRoot, reportProgress, selection)),
    createGzip({ level: 6 }),
    output,
  );
}

/**
 * Report the databases present and their sizes, without copying any content.
 *
 * `--only` is unusable without a way to discover names, and the alternative — an ad-hoc
 * `ls` inside the production container — reaches into a directory `AGENTS.md` §3 lists as
 * do-not-read. This keeps that discovery inside the reviewed tool and returns metadata only.
 */
export function describeDatabases(dbDir) {
  return listDatabaseFiles(dbDir).map((name) => {
    const { size, mtime } = fs.statSync(path.join(dbDir, name));
    return { name, sizeBytes: size, modifiedAt: new Date(mtime).toISOString() };
  });
}

if (process.env.PANINO_STREAM_BACKUP_RUN === "1") {
  const dbDir = process.env.DB_DIR || "/app/data";
  try {
    if (process.env.PANINO_BACKUP_LIST === "1") {
      process.stdout.write(`${JSON.stringify(describeDatabases(dbDir), null, 2)}\n`);
    } else {
      await streamDatabaseBackup(dbDir);
    }
  } catch (error) {
    console.error(`[database-backup] ${error.message}`);
    process.exitCode = 1;
  }
}

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { createDatabaseTar } from "../../../../scripts/production-database-backup/stream-database-backup.mjs";
import {
  stageProductionRestore,
  verifyArchiveChecksum,
  verifyInstalledRestore,
  verifyStagedDirectory,
} from "../../../../scripts/production-database-backup/stage-production-restore.mjs";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const SPACE_ID = "22222222-2222-4222-8222-222222222222";
const MANIFEST = "panino-backup-manifest.json";

/**
 * An estate as production holds it: every database in write-ahead-logging mode
 * (the service sets that on open), one personal library, and optionally spaces.
 */
function createWalSource(root, { withSpaces = true } = {}) {
  const dataDir = path.join(root, "wal-data");
  const uploadsDir = path.join(root, "wal-uploads");
  fs.mkdirSync(dataDir, { recursive: true });
  const open = (file) => {
    const db = new Database(path.join(dataDir, file));
    db.pragma("journal_mode = wal");
    return db;
  };

  const authDb = open("_users.db");
  authDb.exec("CREATE TABLE users (id TEXT PRIMARY KEY)");
  authDb.prepare("INSERT INTO users (id) VALUES (?)").run(OWNER_ID);
  authDb.close();

  const personalDb = open(`${OWNER_ID}.db`);
  personalDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, content TEXT)");
  personalDb.prepare("INSERT INTO notes VALUES (?, ?)").run("note-P", "personal");
  personalDb.close();

  // A personal image: in the uploads volume, in no archive.
  fs.mkdirSync(path.join(uploadsDir, OWNER_ID), { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, OWNER_ID, "personal.png"), "personal image bytes");

  if (withSpaces) {
    fs.mkdirSync(path.join(dataDir, "spaces"), { recursive: true });
    const spacesDb = open("_spaces.db");
    spacesDb.exec(`
      CREATE TABLE spaces (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, status TEXT NOT NULL, delete_after TEXT);
      CREATE TABLE space_members (space_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL);
      CREATE TABLE space_invites (token_hash TEXT PRIMARY KEY, space_id TEXT NOT NULL);
      CREATE TABLE space_user_versions (user_id TEXT PRIMARY KEY, version INTEGER NOT NULL);
    `);
    spacesDb.prepare("INSERT INTO spaces VALUES (?, ?, 'active', NULL)").run(SPACE_ID, OWNER_ID);
    spacesDb.prepare("INSERT INTO space_members VALUES (?, ?, 'owner')").run(SPACE_ID, OWNER_ID);
    spacesDb.prepare("INSERT INTO space_user_versions VALUES (?, 1)").run(OWNER_ID);
    spacesDb.close();

    const contentDb = open(path.join("spaces", `${SPACE_ID}.db`));
    contentDb.exec(`
      CREATE TABLE notes (id TEXT PRIMARY KEY, content TEXT);
      CREATE TABLE images (id TEXT PRIMARY KEY, path TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL);
    `);
    const imageBytes = Buffer.from("space image bytes");
    contentDb.prepare("INSERT INTO images VALUES (?, ?, ?, ?)").run(
      "image-S", "image-S.png", imageBytes.length, crypto.createHash("sha256").update(imageBytes).digest("hex"),
    );
    contentDb.close();
    fs.mkdirSync(path.join(uploadsDir, "spaces", SPACE_ID), { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, "spaces", SPACE_ID, "image-S.png"), imageBytes);
  }
  return { dataDir, uploadsDir };
}

/** Copy a validated staging directory into two separate volume directories, as a restore does. */
function install(root, stagingDir, source) {
  const dataDir = path.join(root, "volume-data");
  const uploadsDir = path.join(root, "volume-uploads");
  fs.cpSync(path.join(stagingDir, "data"), dataDir, {
    recursive: true,
    filter: (file) => !/\.db-(wal|shm)$/.test(file),
  });
  // The uploads volume keeps its personal files; only the space tree is replaced.
  fs.cpSync(source.uploadsDir, uploadsDir, { recursive: true });
  fs.rmSync(path.join(uploadsDir, "spaces"), { recursive: true, force: true });
  if (fs.existsSync(path.join(stagingDir, "uploads", "spaces"))) {
    fs.cpSync(path.join(stagingDir, "uploads", "spaces"), path.join(uploadsDir, "spaces"), { recursive: true });
  }
  return { manifestPath: path.join(stagingDir, MANIFEST), dataDir, uploadsDir };
}

async function collect(chunks) {
  const buffers = [];
  for await (const chunk of chunks) buffers.push(chunk);
  return Buffer.concat(buffers);
}

function createSource(root, { includeSpaceDatabase = true, includeUpload = true } = {}) {
  const dataDir = path.join(root, "source-data");
  const uploadsDir = path.join(root, "source-uploads");
  fs.mkdirSync(path.join(dataDir, "spaces"), { recursive: true });

  const authDb = new Database(path.join(dataDir, "_users.db"));
  authDb.exec("CREATE TABLE users (id TEXT PRIMARY KEY)");
  authDb.prepare("INSERT INTO users (id) VALUES (?)").run(OWNER_ID);
  authDb.close();

  const spacesDb = new Database(path.join(dataDir, "_spaces.db"));
  spacesDb.exec(`
    CREATE TABLE spaces (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      delete_after TEXT
    );
    CREATE TABLE space_members (
      space_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL
    );
    CREATE TABLE space_invites (
      token_hash TEXT PRIMARY KEY,
      space_id TEXT NOT NULL
    );
    CREATE TABLE space_user_versions (
      user_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL
    );
  `);
  spacesDb.prepare(
    "INSERT INTO spaces (id, owner_user_id, status, delete_after) VALUES (?, ?, 'active', NULL)",
  ).run(SPACE_ID, OWNER_ID);
  spacesDb.prepare(
    "INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, 'owner')",
  ).run(SPACE_ID, OWNER_ID);
  spacesDb.prepare(
    "INSERT INTO space_user_versions (user_id, version) VALUES (?, 1)",
  ).run(OWNER_ID);
  spacesDb.close();

  if (includeSpaceDatabase) {
    const contentDb = new Database(path.join(dataDir, "spaces", `${SPACE_ID}.db`));
    contentDb.exec(`
      CREATE TABLE notes (id TEXT PRIMARY KEY, content TEXT);
      CREATE TABLE images (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL
      );
    `);
    contentDb.prepare("INSERT INTO notes VALUES (?, ?)").run("note-A", "restored");
    const imageBytes = Buffer.from("restored image bytes");
    contentDb.prepare("INSERT INTO images VALUES (?, ?, ?, ?)").run(
      "image-A",
      "image-A.png",
      imageBytes.length,
      crypto.createHash("sha256").update(imageBytes).digest("hex"),
    );
    contentDb.close();
  }

  const uploadRoot = path.join(uploadsDir, "spaces", SPACE_ID);
  if (includeSpaceDatabase || includeUpload) {
    fs.mkdirSync(uploadRoot, { recursive: true });
  }
  if (includeUpload) {
    fs.writeFileSync(path.join(uploadRoot, "image-A.png"), "restored image bytes");
  }
  return { dataDir, uploadsDir };
}

async function writeArchive(root, source) {
  const rawTar = await collect(
    createDatabaseTar(source.dataDir, root, () => {}, {}, source.uploadsDir),
  );
  const archivePath = path.join(root, "backup.tar.gz");
  const archive = gzipSync(rawTar);
  fs.writeFileSync(archivePath, archive);
  const checksum = crypto.createHash("sha256").update(archive).digest("hex");
  fs.writeFileSync(`${archivePath}.sha256`, `${checksum}  ${path.basename(archivePath)}\n`);
  return archivePath;
}

describe("production restore staging", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "panino-production-restore-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("stages one all-or-nothing space set after checksum, hash, SQLite, and invariant validation", async () => {
    const source = createSource(tempDir);
    const archivePath = await writeArchive(tempDir, source);
    const stagingDir = path.join(tempDir, "validated-stage");

    const result = await stageProductionRestore({ archivePath, stagingDir });

    expect(result).toMatchObject({ stagingDir, spaces: 1 });
    await expect(verifyStagedDirectory(stagingDir)).resolves.toMatchObject({ spaces: 1 });
    expect(fs.readFileSync(
      path.join(stagingDir, "uploads", "spaces", SPACE_ID, "image-A.png"),
      "utf8",
    )).toBe("restored image bytes");
    const restored = new Database(path.join(stagingDir, "data", "spaces", `${SPACE_ID}.db`), {
      readonly: true,
    });
    expect(restored.prepare("SELECT content FROM notes WHERE id = 'note-A'").pluck().get()).toBe("restored");
    restored.close();
  });

  it("rejects a checksum mismatch before creating a staging target", async () => {
    const archivePath = await writeArchive(tempDir, createSource(tempDir));
    fs.writeFileSync(`${archivePath}.sha256`, `${"0".repeat(64)}  backup.tar.gz\n`);
    const stagingDir = path.join(tempDir, "never-created");

    await expect(stageProductionRestore({ archivePath, stagingDir })).rejects.toThrow(/checksum mismatch/i);
    expect(fs.existsSync(stagingDir)).toBe(false);
  });

  it("rejects metadata that advertises a space without its database", async () => {
    const archivePath = await writeArchive(
      tempDir,
      createSource(tempDir, { includeSpaceDatabase: false, includeUpload: false }),
    );
    const stagingDir = path.join(tempDir, "invalid-stage");

    await expect(stageProductionRestore({ archivePath, stagingDir })).rejects.toThrow(
      /metadata and archived space databases do not match/,
    );
    expect(fs.existsSync(stagingDir)).toBe(false);
  });

  it("rejects a space database whose referenced image bytes are absent", async () => {
    const archivePath = await writeArchive(
      tempDir,
      createSource(tempDir, { includeUpload: false }),
    );
    const stagingDir = path.join(tempDir, "missing-image-stage");

    await expect(stageProductionRestore({ archivePath, stagingDir })).rejects.toThrow(
      /missing referenced image bytes/,
    );
    expect(fs.existsSync(stagingDir)).toBe(false);
  });

  it("stages write-ahead-logging databases and can verify the same directory again", async () => {
    // Opening a WAL database, even read-only, leaves -wal and -shm files beside
    // it. Counting those as unexpected content made every re-verification fail.
    const archivePath = await writeArchive(tempDir, createWalSource(tempDir));
    const stagingDir = path.join(tempDir, "wal-stage");

    await expect(stageProductionRestore({ archivePath, stagingDir })).resolves.toMatchObject({ spaces: 1 });
    await expect(verifyStagedDirectory(stagingDir)).resolves.toMatchObject({ spaces: 1 });
    await expect(verifyStagedDirectory(stagingDir)).resolves.toMatchObject({ spaces: 1 });
  });

  it("refuses a staged database that was written to after validation", async () => {
    const archivePath = await writeArchive(tempDir, createWalSource(tempDir));
    const stagingDir = path.join(tempDir, "touched-stage");
    await stageProductionRestore({ archivePath, stagingDir });

    const db = new Database(path.join(stagingDir, "data", `${OWNER_ID}.db`));
    db.pragma("wal_autocheckpoint = 0");
    db.prepare("INSERT INTO notes VALUES (?, ?)").run("note-late", "written after staging");
    // Leave the change in the log, as a crashed or still-running process would.
    fs.copyFileSync(path.join(stagingDir, "data", `${OWNER_ID}.db-wal`), path.join(tempDir, "kept-wal"));
    db.close();
    fs.copyFileSync(path.join(tempDir, "kept-wal"), path.join(stagingDir, "data", `${OWNER_ID}.db-wal`));

    await expect(verifyStagedDirectory(stagingDir)).rejects.toThrow(/written after the backup was validated|Manifest verification failed/);
  });

  it("stages an estate backed up before shared spaces existed", async () => {
    const source = createWalSource(tempDir, { withSpaces: false });
    const archivePath = await writeArchive(tempDir, source);
    const stagingDir = path.join(tempDir, "personal-only-stage");

    await expect(stageProductionRestore({ archivePath, stagingDir })).resolves.toMatchObject({ spaces: 0, entries: 2 });
    await expect(verifyStagedDirectory(stagingDir)).resolves.toMatchObject({ spaces: 0 });
    const manifest = JSON.parse(fs.readFileSync(path.join(stagingDir, MANIFEST), "utf8"));
    expect(manifest).toMatchObject({ scope: "full", spacesMetadata: false, spaces: [] });
    expect(fs.existsSync(path.join(stagingDir, "data", "_spaces.db"))).toBe(false);
  });

  it("refuses a manifest that claims no space metadata but carries space content", async () => {
    const archivePath = await writeArchive(tempDir, createWalSource(tempDir));
    const stagingDir = path.join(tempDir, "claimed-stage");
    await stageProductionRestore({ archivePath, stagingDir });
    const manifestPath = path.join(stagingDir, MANIFEST);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, spacesMetadata: false }));

    await expect(verifyStagedDirectory(stagingDir)).rejects.toThrow(/shared-space content but no space metadata/);
  });

  describe("an installed set", () => {
    async function stagedAndInstalled(options) {
      const source = createWalSource(tempDir, options);
      const archivePath = await writeArchive(tempDir, source);
      const stagingDir = path.join(tempDir, "stage");
      await stageProductionRestore({ archivePath, stagingDir });
      return install(tempDir, stagingDir, source);
    }

    it("is verified in its two volume directories, personal uploads left alone", async () => {
      const installed = await stagedAndInstalled();

      await expect(verifyInstalledRestore(installed)).resolves.toMatchObject({ spaces: 1, entries: 5 });
      // Verifying opened the databases; it must still pass a second time.
      await expect(verifyInstalledRestore(installed)).resolves.toMatchObject({ spaces: 1 });
      expect(fs.readFileSync(path.join(installed.uploadsDir, OWNER_ID, "personal.png"), "utf8")).toBe("personal image bytes");
    });

    it("is verified for an estate without shared spaces", async () => {
      const installed = await stagedAndInstalled({ withSpaces: false });

      await expect(verifyInstalledRestore(installed)).resolves.toMatchObject({ spaces: 0, entries: 2 });
    });

    it("is refused when a database is not the one from the backup", async () => {
      const installed = await stagedAndInstalled();
      const db = new Database(path.join(installed.dataDir, `${OWNER_ID}.db`));
      db.pragma("journal_mode = delete");
      db.prepare("INSERT INTO notes VALUES (?, ?)").run("note-X", "not in the backup");
      db.close();

      await expect(verifyInstalledRestore(installed)).rejects.toThrow(/Manifest verification failed for data\//);
    });

    it("is refused when a database the backup does not contain is present", async () => {
      const installed = await stagedAndInstalled();
      new Database(path.join(installed.dataDir, "33333333-3333-4333-8333-333333333333.db")).close();

      await expect(verifyInstalledRestore(installed)).rejects.toThrow(/do not exactly match the manifest/);
    });

    it("is refused when a shared-space upload is missing or extra", async () => {
      const installed = await stagedAndInstalled();
      const spaceRoot = path.join(installed.uploadsDir, "spaces", SPACE_ID);
      fs.writeFileSync(path.join(spaceRoot, "stray.png"), "not in the backup");
      await expect(verifyInstalledRestore(installed)).rejects.toThrow(/do not exactly match the manifest/);

      fs.rmSync(path.join(spaceRoot, "stray.png"));
      fs.rmSync(path.join(spaceRoot, "image-S.png"));
      await expect(verifyInstalledRestore(installed)).rejects.toThrow(/Manifest verification failed for uploads\//);
    });

    it("needs all three locations", async () => {
      await expect(verifyInstalledRestore({ manifestPath: "m", dataDir: tempDir })).rejects.toThrow(/are required/);
      await expect(verifyInstalledRestore({ manifestPath: "m", dataDir: tempDir, uploadsDir: path.join(tempDir, "absent") }))
        .rejects.toThrow(/Not a directory/);
    });
  });

  it("requires a checksum file that names the selected archive", async () => {
    const archivePath = await writeArchive(tempDir, createSource(tempDir));
    fs.writeFileSync(`${archivePath}.sha256`, `${"0".repeat(64)}  another.tar.gz\n`);

    await expect(verifyArchiveChecksum(archivePath)).rejects.toThrow(/does not name/);
  });
});

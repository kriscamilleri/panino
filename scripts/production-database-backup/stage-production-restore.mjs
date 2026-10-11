#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_MANIFEST_PATH,
  validateArchivePath,
} from "./stream-database-backup.mjs";
import { assertSpacesInvariants } from "../../backend/api-service/spaces.js";

const require = createRequire(new URL("../../backend/api-service/package.json", import.meta.url));
const Database = require("better-sqlite3");
const TAR_BLOCK_SIZE = 512;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SQLITE_SIDECAR_PATTERN = /\.db-(wal|shm|journal)$/;

/**
 * SQLite creates `-wal` and `-shm` files beside a write-ahead-logging database as
 * soon as it is opened, even read-only, so validating a set leaves them behind.
 * They are not part of the set. An empty log and its index are ignored; a log with
 * content, or a rollback journal, means the database was written to after it was
 * validated.
 */
function isIgnorableSidecar(target, name) {
  const kind = SQLITE_SIDECAR_PATTERN.exec(name)?.[1];
  if (!kind) return false;
  if (kind === "shm") return true;
  if (kind === "wal" && fs.statSync(target).size === 0) return true;
  throw new Error(`${name} holds changes written after the backup was validated`);
}

async function hashFile(target) {
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of fs.createReadStream(target)) {
    hash.update(chunk);
    sizeBytes += chunk.length;
  }
  return { sizeBytes, sha256: hash.digest("hex") };
}

function parseOctal(buffer, fieldName) {
  const value = buffer.toString("ascii").replace(/\0.*$/, "").trim();
  if (!/^[0-7]+$/.test(value)) throw new Error(`Invalid tar ${fieldName}`);
  return Number.parseInt(value, 8);
}

function parseHeader(header) {
  const storedChecksum = parseOctal(header.subarray(148, 156), "checksum");
  const checksumHeader = Buffer.from(header);
  checksumHeader.fill(0x20, 148, 156);
  const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
  if (storedChecksum !== actualChecksum) throw new Error("Tar header checksum mismatch");
  const name = header.subarray(0, 100).toString("ascii").replace(/\0.*$/, "");
  validateArchivePath(name);
  const type = header[156];
  if (type !== 0 && type !== 0x30) throw new Error(`Unsupported tar entry type for ${name}`);
  return { name, size: parseOctal(header.subarray(124, 136), "size") };
}

function resolveStagedPath(stagingRoot, archivePath) {
  validateArchivePath(archivePath);
  const root = path.resolve(stagingRoot);
  const target = path.resolve(root, ...archivePath.split("/"));
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Archive entry escaped staging root: ${archivePath}`);
  }
  return target;
}

function allowedArchivePath(name) {
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  return name === BACKUP_MANIFEST_PATH ||
    new RegExp(`^data/(?:_spaces|_users|${uuid})\\.db$`).test(name) ||
    new RegExp(`^data/spaces/${uuid}\\.db$`).test(name) ||
    new RegExp(`^uploads/spaces/${uuid}/.+$`).test(name);
}

/** Verify the companion sha256 file before any extraction occurs. */
export async function verifyArchiveChecksum(archivePath, checksumPath = `${archivePath}.sha256`) {
  const checksumLine = fs.readFileSync(checksumPath, "utf8").trim();
  const match = checksumLine.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
  if (!match || path.basename(match[2]) !== path.basename(archivePath)) {
    throw new Error("Checksum file does not name the selected archive");
  }
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(archivePath)) hash.update(chunk);
  if (hash.digest("hex") !== match[1].toLowerCase()) {
    throw new Error("Archive SHA-256 checksum mismatch");
  }
}

/** Extract only this tool's regular-file tar dialect into a new staging root. */
export async function extractBackupArchive(archivePath, stagingRoot) {
  const extracted = new Map();
  let pending = Buffer.alloc(0);
  let current = null;
  let padding = 0;
  let zeroBlocks = 0;

  try {
    const input = fs.createReadStream(archivePath).pipe(createGunzip());
    for await (const chunk of input) {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length > 0) {
        if (current) {
          const length = Math.min(current.remaining, pending.length);
          const data = pending.subarray(0, length);
          fs.writeSync(current.fd, data);
          current.hash.update(data);
          current.remaining -= length;
          pending = pending.subarray(length);
          if (current.remaining === 0) {
            fs.closeSync(current.fd);
            extracted.set(current.name, {
              sizeBytes: current.size,
              sha256: current.hash.digest("hex"),
            });
            padding = (TAR_BLOCK_SIZE - (current.size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
            current = null;
          }
          continue;
        }
        if (padding > 0) {
          const length = Math.min(padding, pending.length);
          pending = pending.subarray(length);
          padding -= length;
          continue;
        }
        if (pending.length < TAR_BLOCK_SIZE) break;
        const header = pending.subarray(0, TAR_BLOCK_SIZE);
        pending = pending.subarray(TAR_BLOCK_SIZE);
        if (header.every((byte) => byte === 0)) {
          zeroBlocks += 1;
          continue;
        }
        if (zeroBlocks > 0) throw new Error("Unexpected tar entry after end marker");
        const entry = parseHeader(header);
        if (!allowedArchivePath(entry.name)) throw new Error(`Unexpected archive entry: ${entry.name}`);
        if (extracted.has(entry.name)) throw new Error(`Duplicate archive entry: ${entry.name}`);
        const target = resolveStagedPath(stagingRoot, entry.name);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        const fd = fs.openSync(target, "wx", 0o600);
        current = {
          ...entry,
          fd,
          remaining: entry.size,
          hash: crypto.createHash("sha256"),
        };
        if (entry.size === 0) {
          fs.closeSync(fd);
          extracted.set(entry.name, { sizeBytes: 0, sha256: current.hash.digest("hex") });
          current = null;
        }
      }
    }
  } finally {
    if (current?.fd !== undefined) fs.closeSync(current.fd);
  }
  if (current || padding > 0 || pending.length > 0 || zeroBlocks < 2) {
    throw new Error("Archive ended before a complete tar end marker");
  }
  return extracted;
}

function verifySqliteIntegrity(databasePath) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.pragma("integrity_check");
    if (rows.length !== 1 || rows[0].integrity_check !== "ok") {
      throw new Error(`SQLite integrity_check failed for ${path.basename(databasePath)}`);
    }
  } finally {
    db.close();
  }
}

function verifySpaceImageAssets(locate, spaceId) {
  const databasePath = locate(`data/spaces/${spaceId}.db`);
  const uploadsRoot = locate(`uploads/spaces/${spaceId}`);
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const hasImages = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'images'",
    ).get();
    if (!hasImages) return;
    const images = db.prepare(
      "SELECT path, size_bytes AS sizeBytes, sha256 FROM images",
    ).all();
    for (const image of images) {
      if (
        typeof image.path !== "string" ||
        !image.path ||
        image.path !== path.basename(image.path) ||
        image.path.includes("\\")
      ) {
        throw new Error(`Space ${spaceId} contains a noncanonical image path`);
      }
      const imagePath = path.resolve(uploadsRoot, image.path);
      if (!imagePath.startsWith(`${uploadsRoot}${path.sep}`)) {
        throw new Error(`Space ${spaceId} image path escaped its upload root`);
      }
      const stat = fs.statSync(imagePath, { throwIfNoEntry: false });
      if (!stat?.isFile()) throw new Error(`Space ${spaceId} is missing referenced image bytes`);
      if (Number.isSafeInteger(image.sizeBytes) && image.sizeBytes >= 0 && stat.size !== image.sizeBytes) {
        throw new Error(`Space ${spaceId} image size does not match its database row`);
      }
      if (SHA256_PATTERN.test(image.sha256 || "")) {
        const digest = crypto.createHash("sha256").update(fs.readFileSync(imagePath)).digest("hex");
        if (digest !== image.sha256) throw new Error(`Space ${spaceId} image hash does not match its database row`);
      }
    }
  } finally {
    db.close();
  }
}

function requireManifestShape(manifest) {
  if (manifest?.format !== BACKUP_FORMAT || manifest?.version !== BACKUP_FORMAT_VERSION) {
    throw new Error("Unsupported production backup format");
  }
  if (manifest.scope !== "full") throw new Error("Selected diagnostic backups cannot be restored as a full estate");
  if (!Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("Backup manifest timestamp is invalid");
  if (!Array.isArray(manifest.entries) || !Array.isArray(manifest.spaces)) {
    throw new Error("Backup manifest is incomplete");
  }
}

/** Validate hashes, every SQLite file, metadata invariants, and the complete space set. */
export function verifyStagedRestore(stagingRoot, extracted) {
  const manifestPath = resolveStagedPath(stagingRoot, BACKUP_MANIFEST_PATH);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return verifyRestoreSet(manifest, extracted, (archivePath) => resolveStagedPath(stagingRoot, archivePath));
}

/**
 * The checks themselves, independent of where the set lives.
 *
 * @param {object} manifest the backup manifest
 * @param {Map<string, { sizeBytes: number, sha256: string }>} extracted files found, by archive path
 * @param {(archivePath: string) => string} locate where an archive path is on disk
 */
function verifyRestoreSet(manifest, extracted, locate) {
  requireManifestShape(manifest);
  const expectedPaths = new Set();
  for (const entry of manifest.entries) {
    validateArchivePath(entry?.path);
    if (!allowedArchivePath(entry.path)) throw new Error(`Unexpected manifest path: ${entry.path}`);
    if (expectedPaths.has(entry.path)) throw new Error(`Duplicate manifest path: ${entry.path}`);
    if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 || !SHA256_PATTERN.test(entry.sha256)) {
      throw new Error(`Invalid manifest metadata for ${entry.path}`);
    }
    const actual = extracted.get(entry.path);
    if (!actual || actual.sizeBytes !== entry.sizeBytes || actual.sha256 !== entry.sha256) {
      throw new Error(`Manifest verification failed for ${entry.path}`);
    }
    expectedPaths.add(entry.path);
  }
  const nonManifestPaths = [...extracted.keys()].filter((name) => name !== BACKUP_MANIFEST_PATH);
  if (nonManifestPaths.some((name) => !expectedPaths.has(name)) || expectedPaths.size !== nonManifestPaths.length) {
    throw new Error("Archive entries do not exactly match the manifest");
  }
  // An estate backed up before shared spaces existed has no metadata database
  // and must then have no space content either. The service creates an empty
  // _spaces.db when it starts on such a set.
  const hasSpacesMetadata = manifest.spacesMetadata !== false;
  for (const required of hasSpacesMetadata ? ["data/_spaces.db", "data/_users.db"] : ["data/_users.db"]) {
    if (!expectedPaths.has(required)) throw new Error(`Full backup is missing ${required}`);
  }
  for (const archivePath of expectedPaths) {
    if (archivePath.endsWith(".db")) verifySqliteIntegrity(locate(archivePath));
  }
  if (!hasSpacesMetadata) {
    const spaceContent = [...expectedPaths].some((archivePath) =>
      archivePath === "data/_spaces.db" || archivePath.startsWith("data/spaces/") || archivePath.startsWith("uploads/spaces/"));
    if (manifest.spaces.length > 0 || spaceContent) {
      throw new Error("Backup holds shared-space content but no space metadata database");
    }
    return manifest;
  }

  const authDb = new Database(locate("data/_users.db"), { readonly: true, fileMustExist: true });
  const spacesDb = new Database(locate("data/_spaces.db"), { readonly: true, fileMustExist: true });
  try {
    assertSpacesInvariants(spacesDb, { authDb });
    const metadataSpaceIds = spacesDb.prepare("SELECT id FROM spaces ORDER BY id").pluck().all();
    const manifestSpaceIds = manifest.spaces.map((space) => space?.spaceId).sort();
    if (new Set(manifestSpaceIds).size !== manifestSpaceIds.length || manifestSpaceIds.some((id) => !UUID_PATTERN.test(id))) {
      throw new Error("Backup manifest contains invalid or duplicate space ids");
    }
    if (JSON.stringify(metadataSpaceIds) !== JSON.stringify(manifestSpaceIds)) {
      throw new Error("Space metadata and archived space databases do not match");
    }
    for (const space of manifest.spaces) {
      const expectedDatabasePath = `data/spaces/${space.spaceId}.db`;
      const expectedUploadsPrefix = `uploads/spaces/${space.spaceId}/`;
      if (space.databasePath !== expectedDatabasePath || space.uploadsPrefix !== expectedUploadsPrefix) {
        throw new Error(`Invalid restore mapping for space ${space.spaceId}`);
      }
      if (!expectedPaths.has(expectedDatabasePath)) throw new Error(`Missing database for space ${space.spaceId}`);
      verifySpaceImageAssets(locate, space.spaceId);
    }
    for (const archivePath of expectedPaths) {
      if (!archivePath.startsWith("uploads/spaces/")) continue;
      const spaceId = archivePath.split("/")[2];
      if (!manifestSpaceIds.includes(spaceId)) throw new Error(`Upload belongs to an unknown space: ${spaceId}`);
    }
  } finally {
    spacesDb.close();
    authDb.close();
  }
  return manifest;
}

function materializeSpaceUploadRoots(stagingRoot, manifest) {
  for (const space of manifest.spaces) {
    fs.mkdirSync(resolveStagedPath(stagingRoot, space.uploadsPrefix.slice(0, -1)), {
      recursive: true,
      mode: 0o700,
    });
  }
}

/** Hash every regular file under `root`, keyed by `prefix` plus its relative path. */
async function describeTree(root, prefix = "") {
  const found = new Map();
  async function visit(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Restore set contains a symbolic link: ${relativePath}`);
      if (entry.isDirectory()) await visit(target, relativePath);
      else if (entry.isFile()) {
        if (isIgnorableSidecar(target, entry.name)) continue;
        validateArchivePath(relativePath);
        found.set(relativePath, await hashFile(target));
      } else {
        throw new Error(`Restore set contains an unsupported entry: ${relativePath}`);
      }
    }
  }
  await visit(root, prefix);
  return found;
}

const describeStagedFiles = (stagingRoot) => describeTree(stagingRoot);

/**
 * The files of an installed set. The two volumes are separate directories, and
 * only part of each belongs to the set: every database in the data volume, and
 * the shared-space tree of the uploads volume. Personal uploads live beside that
 * tree and are in no archive, so they are neither checked nor a reason to fail.
 */
async function describeInstalledFiles(dataDir, uploadsDir) {
  const found = new Map();
  for (const [directory, prefix] of [[dataDir, "data/"], [path.join(dataDir, "spaces"), "data/spaces/"]]) {
    if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Installed data contains a symbolic link: ${prefix}${entry.name}`);
      if (!entry.isFile() || isIgnorableSidecar(target, entry.name) || !entry.name.endsWith(".db")) continue;
      found.set(`${prefix}${entry.name}`, await hashFile(target));
    }
  }
  const spaceUploads = path.join(uploadsDir, "spaces");
  if (fs.statSync(spaceUploads, { throwIfNoEntry: false })?.isDirectory()) {
    for (const [relativePath, file] of await describeTree(spaceUploads, "uploads/spaces")) found.set(relativePath, file);
  }
  return found;
}

function installedLocator(dataDir, uploadsDir) {
  const roots = { data: path.resolve(dataDir), uploads: path.resolve(uploadsDir) };
  return (archivePath) => {
    validateArchivePath(archivePath);
    const [top, ...rest] = archivePath.split("/");
    const root = roots[top];
    if (!root || rest.length === 0) throw new Error(`No installed location for ${archivePath}`);
    const target = path.resolve(root, ...rest);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Archive entry escaped its volume: ${archivePath}`);
    return target;
  };
}

function requireSpaceUploadRoots(manifest, locate) {
  for (const space of manifest.spaces) {
    if (!fs.statSync(locate(space.uploadsPrefix.slice(0, -1)), { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`Missing upload root for space ${space.spaceId}`);
    }
  }
}

/**
 * Check an installed set against the manifest it was restored from, before the
 * service is started on it: every database and shared-space upload is present
 * and byte-identical, nothing extra is in their place, and the same integrity
 * and invariant checks pass. Reads only.
 */
export async function verifyInstalledRestore({ manifestPath, dataDir, uploadsDir }) {
  if (!manifestPath || !dataDir || !uploadsDir) throw new Error("manifestPath, dataDir and uploadsDir are required");
  for (const directory of [dataDir, uploadsDir]) {
    if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Not a directory: ${directory}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const locate = installedLocator(dataDir, uploadsDir);
  verifyRestoreSet(manifest, await describeInstalledFiles(dataDir, uploadsDir), locate);
  requireSpaceUploadRoots(manifest, locate);
  return { createdAt: manifest.createdAt, spaces: manifest.spaces.length, entries: manifest.entries.length };
}

/** Recheck an already staged set without mutating it. */
export async function verifyStagedDirectory(stagingRoot) {
  const extracted = await describeStagedFiles(stagingRoot);
  const manifest = verifyStagedRestore(stagingRoot, extracted);
  requireSpaceUploadRoots(manifest, (archivePath) => resolveStagedPath(stagingRoot, archivePath));
  return { createdAt: manifest.createdAt, spaces: manifest.spaces.length, entries: manifest.entries.length };
}

/** Verify and atomically publish a fully validated staging directory. */
export async function stageProductionRestore({ archivePath, checksumPath = `${archivePath}.sha256`, stagingDir }) {
  if (!archivePath || !stagingDir) throw new Error("An archive (--archive) and a staging directory (--staging-dir) are required");
  if (fs.existsSync(stagingDir)) throw new Error(`Staging target already exists: ${stagingDir}`);
  await verifyArchiveChecksum(archivePath, checksumPath);
  const parent = path.dirname(path.resolve(stagingDir));
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = fs.mkdtempSync(path.join(parent, ".panino-restore-"));
  try {
    const extracted = await extractBackupArchive(archivePath, temporary);
    const manifest = verifyStagedRestore(temporary, extracted);
    materializeSpaceUploadRoots(temporary, manifest);
    fs.renameSync(temporary, stagingDir);
    return { stagingDir, createdAt: manifest.createdAt, spaces: manifest.spaces.length, entries: manifest.entries.length };
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function usage() {
  return "Usage: stage-production-restore.mjs --archive PATH --staging-dir PATH [--checksum PATH]\n" +
    "   or: stage-production-restore.mjs --verify-dir STAGING_DIR\n" +
    "   or: stage-production-restore.mjs --verify-installed MANIFEST --data-dir PATH --uploads-dir PATH";
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return { help: true };
    const known = ["--archive", "--checksum", "--staging-dir", "--verify-dir", "--verify-installed", "--data-dir", "--uploads-dir"];
    if (!known.includes(flag) || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete option: ${flag}`);
    }
    options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[index + 1];
    index += 1;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
    } else if (options.verifyInstalled) {
      if (options.archive || options.checksum || options.stagingDir || options.verifyDir) {
        throw new Error("--verify-installed takes only --data-dir and --uploads-dir");
      }
      const result = await verifyInstalledRestore({
        manifestPath: options.verifyInstalled,
        dataDir: options.dataDir,
        uploadsDir: options.uploadsDir,
      });
      process.stdout.write(
        `Installed set matches the backup (${result.spaces} spaces, ${result.entries} files, snapshot ${result.createdAt}).\n`,
      );
    } else if (options.verifyDir) {
      if (options.archive || options.checksum || options.stagingDir || options.dataDir || options.uploadsDir) {
        throw new Error("--verify-dir cannot be combined with other options");
      }
      const result = await verifyStagedDirectory(options.verifyDir);
      process.stdout.write(
        `Restore directory is valid (${result.spaces} spaces, ${result.entries} files, snapshot ${result.createdAt}).\n`,
      );
    } else {
      if (options.dataDir || options.uploadsDir) {
        throw new Error("--archive takes only --staging-dir and --checksum");
      }
      // The flags are not the function's parameter names. Passing the parsed
      // options straight through made the documented command fail with
      // "archivePath and stagingDir are required", whatever it was given.
      const result = await stageProductionRestore({
        archivePath: options.archive,
        checksumPath: options.checksum,
        stagingDir: options.stagingDir,
      });
      process.stdout.write(
        `Restore staged and validated at ${result.stagingDir} (${result.spaces} spaces, ${result.entries} files, snapshot ${result.createdAt}).\n` +
        "No live data was changed. Follow the deployment runbook for an approved maintenance-window swap.\n",
      );
    }
  } catch (error) {
    process.stderr.write(`[production-restore] ${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

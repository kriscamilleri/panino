#!/usr/bin/env node
// backend/api-service/scripts/migrate-globals.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getUserDb, closeAllConnections } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

function listDbFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.db'))
    .filter((name) => name !== '_users.db')
    .map((name) => path.join(dir, name));
}

function userIdFromPath(p) {
  return path.basename(p, '.db');
}

async function main() {
  const dbFiles = listDbFiles(dataDir);
  if (!dbFiles.length) {
    console.log('[migrate-globals] No user databases found.');
    return;
  }

  console.log(`[migrate-globals] Found ${dbFiles.length} database(s).`);
  for (const dbFile of dbFiles) {
    const userId = userIdFromPath(dbFile);
    try {
      getUserDb(userId);
      console.log(`[migrate-globals] Migrated globals schema for ${userId}`);
    } catch (err) {
      console.error(`[migrate-globals] Failed for ${userId}:`, err.message || err);
    }
  }

  closeAllConnections();
  console.log('[migrate-globals] Done.');
}

main().catch((err) => {
  console.error('[migrate-globals] Fatal:', err);
  process.exit(1);
});

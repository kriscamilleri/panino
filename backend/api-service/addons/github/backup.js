/**
 * GitHub backup (docs/specs/active/github-integration.md): the user's GitHub
 * connection in `backup_config`, the snapshot of their personal Documents,
 * folders and images, the commit that pushes it, and the daily auto backup.
 * Routes are in routes.js; the manifest in index.js.
 */

import crypto from 'crypto';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { getHealthyUserDb, getUserDb, parseDbKey } from '../../db.js';
import { decryptSecret, encryptSecret } from '../../secrets.js';
import { isAddonActive } from '../registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The core upload root (image.js), two levels up from this folder.
const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-for-dev';
export const GITHUB_API_URL = process.env.GITHUB_API_URL || 'https://api.github.com';
export const GITHUB_OAUTH_URL = process.env.GITHUB_OAUTH_URL || 'https://github.com/login/oauth';
export const GITHUB_API_VERSION = '2022-11-28';
const MAX_INLINE_CONTENT_BYTES = 100 * 1024;
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_STAGE_SETTLE_MS = 1200;
export const ADDON_ID = 'github';
const BACKUP_PROVIDER = 'github';
const BACKUP_SOURCE_URL = 'https://github.com/kriscamilleri/panino';
const backupJobs = new Map();

export function getGithubClientId() {
  return process.env.GITHUB_CLIENT_ID || '';
}

export function getGithubClientSecret() {
  return process.env.GITHUB_CLIENT_SECRET || '';
}

export function isGithubOauthConfigured() {
  return Boolean(getGithubClientId() && getGithubClientSecret());
}

/** Whether a job is running for the user (disconnect waits for it). */
export function isBackupRunning(userId) {
  return backupJobs.has(userId);
}

function getEncryptionKeyMaterial() {
  return process.env.GITHUB_TOKEN_ENCRYPTION_KEY || JWT_SECRET;
}

export function encryptToken(token) {
  return encryptSecret(token, getEncryptionKeyMaterial());
}

export function decryptToken(token) {
  return decryptSecret(token, getEncryptionKeyMaterial());
}

function sanitizeFileSegment(value, fallback = 'Untitled') {
  const normalized = String(value || fallback)
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '');

  const safeValue = normalized || fallback;
  return safeValue.slice(0, 200);
}

function dedupeFileName(baseName, extension, usedNames) {
  let candidate = `${baseName}${extension}`;
  let index = 2;

  while (usedNames.has(candidate)) {
    candidate = `${baseName} (${index})${extension}`;
    index += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function resolveUploadPath(relativePath) {
  const absolutePath = path.resolve(UPLOADS_DIR, relativePath || '');
  const uploadsRoot = `${UPLOADS_DIR}${path.sep}`;
  if (absolutePath !== UPLOADS_DIR && !absolutePath.startsWith(uploadsRoot)) {
    return null;
  }
  return absolutePath;
}

function escapeLike(value) {
  return String(value).replace(/[!%_]/g, '!$&');
}

function getImageReferencePatterns(imageId) {
  const escapedId = escapeLike(imageId);
  return [`%/images/${escapedId}%`, `%/api/images/${escapedId}%`];
}

function getImageUsage(db, imageId) {
  const [relPattern, apiPattern] = getImageReferencePatterns(imageId);

  const countRow = db.prepare(`
    SELECT COUNT(*) as count
    FROM notes
    WHERE content LIKE ? ESCAPE '!' OR content LIKE ? ESCAPE '!'
  `).get(relPattern, apiPattern);

  const noteRows = db.prepare(`
    SELECT id, title
    FROM notes
    WHERE content LIKE ? ESCAPE '!' OR content LIKE ? ESCAPE '!'
    ORDER BY updated_at DESC, id ASC
    LIMIT 3
  `).all(relPattern, apiPattern);

  return {
    count: Number(countRow?.count || 0),
    notes: noteRows,
  };
}

function formatSkippedImageLabel(image) {
  const imageLabel = image.filename || image.id;
  const noteTitles = [...new Set((image.usage?.notes || [])
    .map((note) => note.title || 'Untitled')
    .filter(Boolean))];

  if (noteTitles.length === 0) {
    return imageLabel;
  }

  return `${imageLabel} (${noteTitles.join(', ')})`;
}

function formatSkippedImagesWarning(skippedImages) {
  if (!Array.isArray(skippedImages) || skippedImages.length === 0) {
    return null;
  }

  const preview = skippedImages.slice(0, 3).map((image) => formatSkippedImageLabel(image));
  const remainingCount = skippedImages.length - preview.length;
  const suffix = remainingCount > 0 ? `, and ${remainingCount} more` : '';
  const countLabel = `${skippedImages.length} missing image${skippedImages.length === 1 ? '' : 's'}`;

  return `Skipped ${countLabel}: ${preview.join(', ')}${suffix}. Re-upload or remove the broken image references to include them next time.`;
}

export function getBackupConfig(db) {
  return db.prepare(`
    SELECT id, provider, access_token_enc, username, avatar_url, repo_full_name,
           auto_backup_enabled, last_backup_at, last_backup_sha, last_warning, last_error, created_at
    FROM backup_config
    WHERE provider = ?
    LIMIT 1
  `).get(BACKUP_PROVIDER) || null;
}

export function saveBackupConfig(db, updates = {}) {
  const existing = getBackupConfig(db);
  const now = new Date().toISOString();
  const record = {
    id: existing?.id || uuidv4(),
    provider: BACKUP_PROVIDER,
    access_token_enc: existing?.access_token_enc || null,
    username: existing?.username || null,
    avatar_url: existing?.avatar_url || null,
    repo_full_name: existing?.repo_full_name || null,
    auto_backup_enabled: existing?.auto_backup_enabled ?? 1,
    last_backup_at: existing?.last_backup_at || null,
    last_backup_sha: existing?.last_backup_sha || null,
    last_warning: existing?.last_warning || null,
    last_error: existing?.last_error || null,
    created_at: existing?.created_at || now,
    ...updates,
  };

  db.prepare(`
    INSERT INTO backup_config (
      id, provider, access_token_enc, username, avatar_url, repo_full_name,
      auto_backup_enabled, last_backup_at, last_backup_sha, last_warning, last_error, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      id = excluded.id,
      access_token_enc = excluded.access_token_enc,
      username = excluded.username,
      avatar_url = excluded.avatar_url,
      repo_full_name = excluded.repo_full_name,
      auto_backup_enabled = excluded.auto_backup_enabled,
      last_backup_at = excluded.last_backup_at,
      last_backup_sha = excluded.last_backup_sha,
      last_warning = excluded.last_warning,
      last_error = excluded.last_error,
      created_at = excluded.created_at
  `).run(
    record.id,
    record.provider,
    record.access_token_enc,
    record.username,
    record.avatar_url,
    record.repo_full_name,
    record.auto_backup_enabled ? 1 : 0,
    record.last_backup_at,
    record.last_backup_sha,
    record.last_warning,
    record.last_error,
    record.created_at,
  );

  return getBackupConfig(db);
}

export function deleteBackupConfig(db) {
  db.prepare('DELETE FROM backup_config WHERE provider = ?').run(BACKUP_PROVIDER);
}

/** An error whose message is written for the user and may be shown as it is. */
function userFacingError(message) {
  const error = new Error(message);
  error.userFacing = true;
  return error;
}

/**
 * The message a user sees for a failure: a fixed sentence, never GitHub's own text or an
 * internal error (AGENTS.md §4). The real error goes to the log.
 *
 * @param {any} error
 * @returns {string}
 */
export function githubFailureMessage(error) {
  if (error?.userFacing) return error.message;
  switch (error?.status) {
    case 401: return 'GitHub no longer accepts this connection. Disconnect, then connect GitHub again.';
    case 403: return 'GitHub refused the request. Check that your account can push to this repository.';
    case 404: return 'GitHub could not find that repository.';
    case 409:
    case 422: return 'GitHub refused the change. Try again in a moment.';
    default: return 'Could not reach GitHub, or GitHub failed. Try again later.';
  }
}

function parseRepoFullName(repoFullName) {
  const [owner, repo] = String(repoFullName || '').split('/');
  if (!owner || !repo) {
    throw userFacingError('Repository must be in owner/repo format');
  }
  return { owner, repo };
}

function createGithubHeaders(token, extraHeaders = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'panino-backup',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    ...extraHeaders,
  };
}

async function parseGithubResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

async function githubRequest(token, pathname, options = {}) {
  const url = pathname.startsWith('http') ? pathname : `${GITHUB_API_URL}${pathname}`;
  const response = await fetch(url, {
    ...options,
    headers: createGithubHeaders(token, options.headers || {}),
  });

  const payload = await parseGithubResponse(response);
  if (!response.ok) {
    const message = payload?.message || `GitHub API request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function exchangeGithubCodeForToken({ code, redirectUri }) {
  const response = await fetch(`${GITHUB_OAUTH_URL}/access_token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'panino-backup',
    },
    body: JSON.stringify({
      client_id: getGithubClientId(),
      client_secret: getGithubClientSecret(),
      code,
      redirect_uri: redirectUri,
    }),
  });

  const payload = await parseGithubResponse(response);
  if (!response.ok || !payload?.access_token) {
    const exchangeError = new Error(payload?.error_description || payload?.error || 'GitHub OAuth token exchange failed');
    exchangeError.status = response.ok ? 401 : response.status;
    throw exchangeError;
  }

  return payload.access_token;
}

export async function fetchGithubViewer(token) {
  return githubRequest(token, '/user');
}

export async function listGithubRepos(token) {
  const repos = [];
  let page = 1;

  while (true) {
    const batch = await githubRequest(
      token,
      `/user/repos?sort=updated&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`
    );

    repos.push(...(Array.isArray(batch) ? batch : []));
    if (!Array.isArray(batch) || batch.length < 100) {
      break;
    }

    page += 1;
  }

  return repos
    .filter((repo) => repo?.permissions?.push)
    .map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      private: Boolean(repo.private),
      htmlUrl: repo.html_url,
      defaultBranch: repo.default_branch,
    }));
}

export async function fetchGithubRepo(token, repoFullName) {
  const { owner, repo } = parseRepoFullName(repoFullName);
  return githubRequest(token, `/repos/${owner}/${repo}`);
}

export async function createGithubRepo(token, name) {
  return githubRequest(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name,
      private: true,
      auto_init: true,
    }),
  });
}

async function getGithubMainRefSha(token, repoFullName) {
  const { owner, repo } = parseRepoFullName(repoFullName);

  try {
    const ref = await githubRequest(token, `/repos/${owner}/${repo}/git/ref/heads/main`);
    return ref?.object?.sha || null;
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function createGithubBlob(token, repoFullName, content, encoding = 'utf-8') {
  const { owner, repo } = parseRepoFullName(repoFullName);
  const payload = await githubRequest(token, `/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content, encoding }),
  });

  return payload.sha;
}

async function createGithubTree(token, repoFullName, tree, onStage, baseTreeSha = null) {
  const { owner, repo } = parseRepoFullName(repoFullName);
  const payload = { tree };
  if (baseTreeSha) {
    payload.base_tree = baseTreeSha;
  }

  onStage?.('building_tree');
  const result = await githubRequest(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return result.sha;
}

async function createGithubCommit(token, repoFullName, treeSha, parentSha, message, onStage) {
  const { owner, repo } = parseRepoFullName(repoFullName);
  const payload = {
    message,
    tree: treeSha,
    parents: parentSha ? [parentSha] : [],
  };

  onStage?.('creating_commit');
  const result = await githubRequest(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return result.sha;
}

async function updateGithubMainRef(token, repoFullName, commitSha, existingRef, onStage) {
  const { owner, repo } = parseRepoFullName(repoFullName);
  const pathName = existingRef
    ? `/repos/${owner}/${repo}/git/refs/heads/main`
    : `/repos/${owner}/${repo}/git/refs`;
  const payload = existingRef
    ? { sha: commitSha, force: false }
    : { ref: 'refs/heads/main', sha: commitSha };

  onStage?.('pushing_to_github');
  await githubRequest(token, pathName, {
    method: existingRef ? 'PATCH' : 'POST',
    body: JSON.stringify(payload),
  });
}

function isRetryableRefUpdateError(error) {
  return error?.status === 409 || error?.status === 422;
}

async function createGithubSnapshotCommit(token, repoFullName, treeSha, message, onStage, maxAttempts = 3) {
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const currentHeadSha = await getGithubMainRefSha(token, repoFullName);
    const commitSha = await createGithubCommit(
      token,
      repoFullName,
      treeSha,
      currentHeadSha,
      message,
      onStage,
    );

    try {
      await updateGithubMainRef(token, repoFullName, commitSha, Boolean(currentHeadSha), onStage);
      return commitSha;
    } catch (error) {
      lastError = error;
      if (!isRetryableRefUpdateError(error) || attempt === maxAttempts - 1) {
        throw error;
      }
    }
  }

  throw lastError || new Error('Failed to update GitHub backup branch');
}

function buildReadmeContent({ notesCount, foldersCount, imagesCount, timestamp }) {
  return `# Panino Backup

Backed up on: ${timestamp}
Notes: ${notesCount} | Folders: ${foldersCount} | Images: ${imagesCount}

This repository is auto-generated by [Panino](${BACKUP_SOURCE_URL}).
Each backup adds a new snapshot commit. Manual edits here may be replaced by a later backup commit.
`;
}

export function buildBackupSnapshot({ folders, notes, images }) {
  const normalizedFolders = Array.isArray(folders) ? folders : [];
  const normalizedNotes = Array.isArray(notes) ? notes : [];
  const normalizedImages = Array.isArray(images) ? images : [];
  const folderPathById = new Map();
  const childrenByParent = new Map();
  const visitedFolders = new Set();

  for (const folder of normalizedFolders) {
    const parentKey = folder.parent_id || '__root__';
    const existing = childrenByParent.get(parentKey) || [];
    existing.push(folder);
    childrenByParent.set(parentKey, existing);
  }

  function visitFolderGroup(parentKey, parentPath) {
    const siblings = [...(childrenByParent.get(parentKey) || [])]
      .sort((left, right) => {
        const leftName = String(left.name || '').toLowerCase();
        const rightName = String(right.name || '').toLowerCase();
        if (leftName !== rightName) return leftName.localeCompare(rightName);
        return String(left.id).localeCompare(String(right.id));
      });

    const usedNames = new Set();
    for (const folder of siblings) {
      if (visitedFolders.has(folder.id)) {
        continue;
      }

      visitedFolders.add(folder.id);
      const segment = dedupeFileName(sanitizeFileSegment(folder.name, 'Untitled Folder'), '', usedNames);
      const fullPath = parentPath ? `${parentPath}/${segment}` : segment;
      folderPathById.set(folder.id, fullPath);
      visitFolderGroup(folder.id, fullPath);
    }
  }

  visitFolderGroup('__root__', '');

  for (const folder of normalizedFolders) {
    if (!visitedFolders.has(folder.id)) {
      visitFolderGroup(folder.id, '');
      if (!folderPathById.has(folder.id)) {
        folderPathById.set(folder.id, sanitizeFileSegment(folder.name, 'Untitled Folder'));
      }
    }
  }

  const entries = [];
  const notesByFolder = new Map();
  for (const note of normalizedNotes) {
    const folderKey = note.folder_id || '__root__';
    const existing = notesByFolder.get(folderKey) || [];
    existing.push(note);
    notesByFolder.set(folderKey, existing);
  }

  for (const [folderId, noteGroup] of notesByFolder.entries()) {
    const usedNames = new Set();
    const folderPath = folderId === '__root__' ? '' : folderPathById.get(folderId) || '';
    const sortedNotes = [...noteGroup].sort((left, right) => {
      const leftTitle = String(left.title || '').toLowerCase();
      const rightTitle = String(right.title || '').toLowerCase();
      if (leftTitle !== rightTitle) return leftTitle.localeCompare(rightTitle);
      return String(left.id).localeCompare(String(right.id));
    });

    for (const note of sortedNotes) {
      const baseName = sanitizeFileSegment(note.title, 'Untitled Note');
      const fileName = dedupeFileName(baseName, '.md', usedNames);
      const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
      entries.push({ path: filePath, content: note.content || '' });
    }
  }

  const assetNames = new Set();
  for (const image of normalizedImages) {
    const storedName = sanitizeFileSegment(path.basename(image.path || image.filename || image.id || 'asset.bin'), 'asset.bin');
    const assetName = dedupeFileName(storedName, '', assetNames);
    entries.push({ path: `_assets/${assetName}`, content: image.content });
  }

  const timestamp = new Date().toISOString();
  entries.unshift({
    path: 'README.md',
    content: buildReadmeContent({
      notesCount: normalizedNotes.length,
      foldersCount: normalizedFolders.length,
      imagesCount: normalizedImages.length,
      timestamp,
    }),
  });

  return {
    timestamp,
    entries,
    counts: {
      folders: normalizedFolders.length,
      notes: normalizedNotes.length,
      images: normalizedImages.length,
    },
  };
}

async function loadBackupSnapshot(userId) {
  const db = getHealthyUserDb(userId, 'backup-image-cleanup');
  const folders = db.prepare('SELECT id, name, parent_id, created_at FROM folders WHERE user_id = ?').all(userId);
  const notes = db.prepare('SELECT id, folder_id, title, content, created_at, updated_at FROM notes WHERE user_id = ?').all(userId);
  const images = db.prepare('SELECT id, filename, path, mime_type, created_at FROM images WHERE user_id = ?').all(userId);

  const imageEntries = [];
  const skippedImages = [];

  for (const image of images) {
    const absolutePath = resolveUploadPath(image.path);
    if (!absolutePath || !fs.existsSync(absolutePath)) {
      const usage = getImageUsage(db, image.id);
      if (usage.count === 0) {
        db.prepare('DELETE FROM images WHERE id = ? AND user_id = ?').run(image.id, userId);
        console.info('[github]', JSON.stringify({
          event: 'image_prune_delete',
          userId: `${String(userId).slice(0, 2)}…${String(userId).slice(-2)}`,
          imageId: `${String(image.id).slice(0, 2)}…${String(image.id).slice(-2)}`,
          reason: 'missing-file',
          syncBit: 0,
        }));
        continue;
      }

      skippedImages.push({ ...image, usage });
      continue;
    }

    imageEntries.push({
      ...image,
      content: fs.readFileSync(absolutePath),
    });
  }

  return {
    ...buildBackupSnapshot({ folders, notes, images: imageEntries }),
    skippedImages,
  };
}

async function createTreeEntries(token, repoFullName, snapshotEntries) {
  const tree = [];

  for (const entry of snapshotEntries) {
    const isBuffer = Buffer.isBuffer(entry.content);
    if (!isBuffer) {
      const textContent = String(entry.content || '');
      if (Buffer.byteLength(textContent, 'utf8') <= MAX_INLINE_CONTENT_BYTES) {
        tree.push({
          path: entry.path,
          mode: '100644',
          type: 'blob',
          content: textContent,
        });
        continue;
      }

      const blobSha = await createGithubBlob(token, repoFullName, Buffer.from(textContent, 'utf8').toString('base64'), 'base64');
      tree.push({
        path: entry.path,
        mode: '100644',
        type: 'blob',
        sha: blobSha,
      });
      continue;
    }

    const blobSha = await createGithubBlob(token, repoFullName, entry.content.toString('base64'), 'base64');
    tree.push({
      path: entry.path,
      mode: '100644',
      type: 'blob',
      sha: blobSha,
    });
  }

  return tree;
}

function getApiBaseUrl(req) {
  if (process.env.PUBLIC_API_BASE_URL) {
    return process.env.PUBLIC_API_BASE_URL.replace(/\/$/, '');
  }

  const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  const suffix = process.env.NODE_ENV === 'production' ? '/api' : '';
  return `${protocol}://${host}${suffix}`;
}

function getFrontendBaseUrl(req) {
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL.replace(/\/$/, '');
  }

  if (process.env.NODE_ENV === 'production') {
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${protocol}://${host}`;
  }

  return 'http://localhost:5173';
}

export function buildGithubCallbackUrl(req) {
  return `${getApiBaseUrl(req)}/addons/${ADDON_ID}/callback`;
}

export function buildFrontendRedirect(req, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });

  const suffix = query.toString();
  // Settings, where the add-on's card opens the backup dialog and reads the result.
  return `${getFrontendBaseUrl(req)}/#/settings${suffix ? `?${suffix}` : ''}`;
}

const PENDING_CONNECTION_TTL_MS = 10 * 60 * 1000;
const pendingConnections = new Map();

/**
 * Park a GitHub authorization code until the signed-in app collects it. The callback
 * cannot store the token itself: it carries no Panino session, so it cannot tell whether
 * the browser coming back belongs to the person who started the connection. Someone could
 * otherwise send a victim their own `state` and have the victim's GitHub token saved on
 * their account. The app hands the handle back with its own sign-in (POST /complete),
 * and the server only completes it for the user the state names.
 *
 * In memory, so a restart drops pending connections; the user connects again.
 *
 * @returns {string} a single-use handle
 */
export function parkPendingConnection({ userId, code, redirectUri }) {
  const now = Date.now();
  for (const [handle, entry] of pendingConnections) {
    if (entry.expiresAt <= now) pendingConnections.delete(handle);
  }
  const handle = crypto.randomBytes(32).toString('base64url');
  pendingConnections.set(handle, { userId, code, redirectUri, expiresAt: now + PENDING_CONNECTION_TTL_MS });
  return handle;
}

/** The parked connection for a handle, once: taking it removes it. */
export function takePendingConnection(handle) {
  const entry = pendingConnections.get(String(handle || ''));
  if (!entry) return null;
  pendingConnections.delete(String(handle));
  return entry.expiresAt > Date.now() ? entry : null;
}

export function createOauthState(userId) {
  return jwt.sign({ purpose: 'github-backup', userId }, JWT_SECRET, { expiresIn: '10m' });
}

export function verifyOauthState(state) {
  const payload = jwt.verify(state, JWT_SECRET);
  if (payload?.purpose !== 'github-backup' || !payload?.userId) {
    throw userFacingError('This GitHub connection link is not valid. Connect GitHub again.');
  }
  return payload.userId;
}

export function getBackupStatusPayload(config, userId) {
  const runningJob = backupJobs.get(userId) || null;
  const connected = Boolean(config?.access_token_enc);
  const autoBackupEnabled = Boolean(config?.auto_backup_enabled);
  const nextScheduledAt = connected && autoBackupEnabled
    ? (config?.last_backup_at
      ? new Date(new Date(config.last_backup_at).getTime() + AUTO_BACKUP_INTERVAL_MS).toISOString()
      : new Date().toISOString())
    : null;

  return {
    oauthConfigured: isGithubOauthConfigured(),
    connected,
    username: config?.username || null,
    avatarUrl: config?.avatar_url || null,
    repoFullName: config?.repo_full_name || null,
    autoBackupEnabled,
    lastBackupAt: config?.last_backup_at || null,
    lastBackupSha: config?.last_backup_sha || null,
    lastWarning: config?.last_warning || null,
    lastError: config?.last_error || null,
    nextScheduledAt,
    isRunning: Boolean(runningJob),
    currentStage: runningJob?.stage || null,
    currentTrigger: runningJob?.trigger || null,
  };
}

async function runBackupForUser(userId, { trigger = 'manual', onStage } = {}) {
  const db = getUserDb(userId);
  const config = getBackupConfig(db);

  if (!config?.access_token_enc) {
    throw userFacingError('GitHub account is not connected');
  }
  if (!config?.repo_full_name) {
    throw userFacingError('No GitHub repository has been selected');
  }

  const accessToken = decryptToken(config.access_token_enc);

  onStage?.('exporting_notes');
  const snapshot = await loadBackupSnapshot(userId);

  onStage?.('building_tree');
  const treeEntries = await createTreeEntries(accessToken, config.repo_full_name, snapshot.entries);
  const treeSha = await createGithubTree(accessToken, config.repo_full_name, treeEntries, onStage);

  onStage?.('creating_commit');
  const commitSha = await createGithubSnapshotCommit(
    accessToken,
    config.repo_full_name,
    treeSha,
    `Panino backup ${snapshot.timestamp} (${trigger})`,
    onStage,
  );

  saveBackupConfig(db, {
    last_backup_at: snapshot.timestamp,
    last_backup_sha: commitSha,
    last_warning: formatSkippedImagesWarning(snapshot.skippedImages),
    last_error: null,
  });

  return { commitSha, snapshot };
}

export async function startBackupForUser(userId, { trigger = 'manual' } = {}) {
  if (backupJobs.has(userId)) {
    return { started: false, reason: 'already-running' };
  }

  const job = {
    stage: 'queued',
    trigger,
    startedAt: new Date().toISOString(),
  };
  backupJobs.set(userId, job);

  void runBackupForUser(userId, {
    trigger,
    onStage(stage) {
      const currentJob = backupJobs.get(userId);
      if (currentJob) {
        currentJob.stage = stage;
      }
    },
  }).catch((error) => {
    const db = getUserDb(userId);
    saveBackupConfig(db, {
      last_warning: null,
      last_error: githubFailureMessage(error),
    });
    console.error('[github] Backup failed:', error);
  }).finally(() => {
    setTimeout(() => {
      backupJobs.delete(userId);
    }, BACKUP_STAGE_SETTLE_MS);
  });

  return { started: true };
}

export async function triggerDailyAutoBackup(userId) {
  if (!userId || backupJobs.has(userId)) {
    return { started: false, reason: 'skipped' };
  }
  if (!isAddonActive(userId, ADDON_ID)) {
    return { started: false, reason: 'addon-off' };
  }

  const db = getUserDb(userId);
  const config = getBackupConfig(db);
  if (!config?.access_token_enc || !config?.repo_full_name || !config?.auto_backup_enabled) {
    return { started: false, reason: 'not-configured' };
  }

  if (config.last_backup_at) {
    const lastBackupAt = new Date(config.last_backup_at).getTime();
    if (Number.isFinite(lastBackupAt) && (Date.now() - lastBackupAt) < AUTO_BACKUP_INTERVAL_MS) {
      return { started: false, reason: 'not-due' };
    }
  }

  return startBackupForUser(userId, { trigger: 'auto' });
}

export function __resetBackupStateForTests() {
  backupJobs.clear();
  pendingConnections.clear();
}

/**
 * The afterSyncRequest hook: a personal sync may start the daily backup. A
 * shared space has no personal backup target, so a space sync never does.
 *
 * @param {string} dbKey
 */
export function triggerAutoBackupAfterSync(dbKey) {
  let parsed;
  try {
    parsed = parseDbKey(dbKey);
  } catch {
    return;
  }
  if (parsed.kind !== 'user') return;
  void triggerDailyAutoBackup(parsed.id).catch((error) => {
    console.error('[github] Auto backup check failed:', error);
  });
}

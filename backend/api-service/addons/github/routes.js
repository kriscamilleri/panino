/**
 * The GitHub add-on's routes. The registry mounts `githubRoutes` at
 * /addons/github behind requireAddon, and `githubPublicRoutes` (the OAuth
 * callback, which GitHub's redirect reaches without a Panino token) at the same
 * prefix before sign-in, behind the offered check only.
 */

import express from 'express';
import { getUserDb } from '../../db.js';
import { isAddonEnabled } from '../registry.js';
import {
  ADDON_ID,
  GITHUB_API_URL,
  GITHUB_API_VERSION,
  GITHUB_OAUTH_URL,
  buildFrontendRedirect,
  buildGithubCallbackUrl,
  createGithubRepo,
  createOauthState,
  decryptToken,
  deleteBackupConfig,
  encryptToken,
  exchangeGithubCodeForToken,
  fetchGithubRepo,
  fetchGithubViewer,
  getBackupConfig,
  getBackupStatusPayload,
  getGithubClientId,
  getGithubClientSecret,
  isBackupRunning,
  isGithubOauthConfigured,
  listGithubRepos,
  saveBackupConfig,
  startBackupForUser,
  verifyOauthState,
} from './backup.js';

export const githubRoutes = express.Router();
export const githubPublicRoutes = express.Router();

githubPublicRoutes.get('/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return res.redirect(buildFrontendRedirect(req, {
      githubBackup: 'error',
      message: errorDescription || error,
    }));
  }

  if (!isGithubOauthConfigured()) {
    return res.redirect(buildFrontendRedirect(req, {
      githubBackup: 'error',
      message: 'GitHub OAuth is not configured on the server',
    }));
  }

  try {
    const userId = verifyOauthState(String(state || ''));
    // The state proves who started the connection; the switch may have changed since.
    if (!isAddonEnabled(userId, ADDON_ID)) {
      return res.redirect(buildFrontendRedirect(req, {
        githubBackup: 'error',
        message: 'Turn on GitHub backup in Settings → Add-ons first.',
      }));
    }
    const accessToken = await exchangeGithubCodeForToken({
      code: String(code || ''),
      redirectUri: buildGithubCallbackUrl(req),
    });
    const viewer = await fetchGithubViewer(accessToken);
    const db = getUserDb(userId);

    saveBackupConfig(db, {
      access_token_enc: encryptToken(accessToken),
      username: viewer?.login || null,
      avatar_url: viewer?.avatar_url || null,
      auto_backup_enabled: 1,
      last_warning: null,
      last_error: null,
    });

    return res.redirect(buildFrontendRedirect(req, { githubBackup: 'connected' }));
  } catch (oauthError) {
    console.error('[github] GitHub OAuth callback failed:', oauthError);
    return res.redirect(buildFrontendRedirect(req, {
      githubBackup: 'error',
      message: oauthError.message,
    }));
  }
});

githubRoutes.get('/status', (req, res) => {
  try {
    const db = getUserDb(req.user.user_id);
    let config = getBackupConfig(db);
    if (config?.access_token_enc) {
      try {
        decryptToken(config.access_token_enc);
      } catch {
        console.warn('[github] Stored token is no longer decryptable; clearing credential for user', req.user.user_id);
        deleteBackupConfig(db);
        config = null;
      }
    }
    res.json(getBackupStatusPayload(config, req.user.user_id));
  } catch (error) {
    console.error('[github] Failed to load status:', error);
    res.status(500).json({ error: 'Failed to load GitHub backup status' });
  }
});

githubRoutes.post('/connect', (req, res) => {
  if (!isGithubOauthConfigured()) {
    return res.status(503).json({ error: 'GitHub OAuth is not configured on the server' });
  }

  const authorizeUrl = new URL(`${GITHUB_OAUTH_URL}/authorize`);
  authorizeUrl.searchParams.set('client_id', getGithubClientId());
  authorizeUrl.searchParams.set('redirect_uri', buildGithubCallbackUrl(req));
  authorizeUrl.searchParams.set('scope', 'repo');
  authorizeUrl.searchParams.set('state', createOauthState(req.user.user_id));
  authorizeUrl.searchParams.set('allow_signup', 'true');

  res.json({ authorizeUrl: authorizeUrl.toString() });
});

githubRoutes.delete('/disconnect', async (req, res) => {
  if (isBackupRunning(req.user.user_id)) {
    return res.status(409).json({ error: 'Backup is currently running' });
  }

  try {
    const db = getUserDb(req.user.user_id);
    const config = getBackupConfig(db);
    if (config?.access_token_enc && isGithubOauthConfigured()) {
      try {
        const token = decryptToken(config.access_token_enc);
        await fetch(`${GITHUB_API_URL}/applications/${getGithubClientId()}/grant`, {
          method: 'DELETE',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Basic ${Buffer.from(`${getGithubClientId()}:${getGithubClientSecret()}`).toString('base64')}`,
            'Content-Type': 'application/json',
            'User-Agent': 'panino-backup',
            'X-GitHub-Api-Version': GITHUB_API_VERSION,
          },
          body: JSON.stringify({ access_token: token }),
        });
      } catch (revokeError) {
        console.warn('[github] Failed to revoke GitHub token during disconnect:', revokeError.message);
      }
    }

    deleteBackupConfig(db);
    res.json({ disconnected: true });
  } catch (error) {
    console.error('[github] Disconnect failed:', error);
    res.status(500).json({ error: 'Failed to disconnect GitHub backup' });
  }
});

githubRoutes.get('/repos', async (req, res) => {
  try {
    const db = getUserDb(req.user.user_id);
    const config = getBackupConfig(db);
    if (!config?.access_token_enc) {
      return res.status(400).json({ error: 'GitHub account is not connected' });
    }

    const repos = await listGithubRepos(decryptToken(config.access_token_enc));
    res.json({ repos });
  } catch (error) {
    console.error('[github] Failed to list repositories:', error);
    res.status(500).json({ error: error.message || 'Failed to load repositories' });
  }
});

githubRoutes.post('/repos', async (req, res) => {
  const repoName = String(req.body?.name || '').trim();
  if (!repoName) {
    return res.status(400).json({ error: 'Repository name is required' });
  }

  try {
    const db = getUserDb(req.user.user_id);
    const config = getBackupConfig(db);
    if (!config?.access_token_enc) {
      return res.status(400).json({ error: 'GitHub account is not connected' });
    }

    const repo = await createGithubRepo(decryptToken(config.access_token_enc), repoName);
    saveBackupConfig(db, {
      repo_full_name: repo.full_name,
      last_warning: null,
      last_error: null,
    });

    res.status(201).json({
      repo: {
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: Boolean(repo.private),
        htmlUrl: repo.html_url,
        defaultBranch: repo.default_branch,
      },
    });
  } catch (error) {
    console.error('[github] Failed to create repository:', error);
    res.status(500).json({ error: error.message || 'Failed to create repository' });
  }
});

githubRoutes.put('/repo', async (req, res) => {
  const repoFullName = String(req.body?.repoFullName || '').trim();
  if (!repoFullName) {
    return res.status(400).json({ error: 'Repository selection is required' });
  }

  try {
    const db = getUserDb(req.user.user_id);
    const config = getBackupConfig(db);
    if (!config?.access_token_enc) {
      return res.status(400).json({ error: 'GitHub account is not connected' });
    }

    const repo = await fetchGithubRepo(decryptToken(config.access_token_enc), repoFullName);
    if (!repo?.permissions?.push) {
      return res.status(403).json({ error: 'You do not have push access to that repository' });
    }

    saveBackupConfig(db, {
      repo_full_name: repo.full_name,
      last_warning: null,
      last_error: null,
    });

    res.json({
      repo: {
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: Boolean(repo.private),
        htmlUrl: repo.html_url,
        defaultBranch: repo.default_branch,
      },
    });
  } catch (error) {
    console.error('[github] Failed to select repository:', error);
    res.status(500).json({ error: error.message || 'Failed to select repository' });
  }
});

githubRoutes.post('/run', async (req, res) => {
  try {
    const result = await startBackupForUser(req.user.user_id, { trigger: 'manual' });
    if (!result.started) {
      return res.status(409).json({ error: 'Backup is already running' });
    }

    return res.status(202).json({ started: true });
  } catch (error) {
    console.error('[github] Failed to start backup:', error);
    return res.status(500).json({ error: error.message || 'Failed to start backup' });
  }
});
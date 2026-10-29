/**
 * The GitHub add-on (docs/specs/active/github-integration.md): its manifest,
 * which is everything core knows about it. Registered when addons/index.js loads.
 */

import { registerAddon } from '../registry.js';
import { ADDON_ID, isGithubOauthConfigured, triggerAutoBackupAfterSync } from './backup.js';
import { githubPublicRoutes, githubRoutes } from './routes.js';
import { GITHUB_USER_SCHEMA, upgradeGithubSchema } from './schema.js';

/**
 * Offered when the operator has set up a GitHub OAuth app. Switching off needs
 * no hook: the daily backup checks the switch, and the connection is kept.
 */
export const githubAddon = Object.freeze({
    id: ADDON_ID,
    name: 'GitHub backup',
    description: 'Back up your personal Documents, folders and images to a GitHub repository you choose, by hand or once a day while you use Panino. What you back up leaves Panino and is committed under your GitHub account.',
    isOffered: isGithubOauthConfigured,
    routes: githubRoutes,
    publicRoutes: githubPublicRoutes,
    schema: { user: GITHUB_USER_SCHEMA, upgrade: upgradeGithubSchema },
    hooks: {
        afterSyncRequest: triggerAutoBackupAfterSync,
    },
    configWarnings: () => (
        isGithubOauthConfigured() && !process.env.GITHUB_TOKEN_ENCRYPTION_KEY
            ? ['GITHUB_TOKEN_ENCRYPTION_KEY is not set, so GitHub tokens are encrypted with JWT_SECRET: rotating JWT_SECRET disconnects every GitHub backup.']
            : []
    ),
});
registerAddon(githubAddon);

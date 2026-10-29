/**
 * The Odoo add-on (docs/specs/active/odoo-integration.md): its manifest, which
 * is everything core knows about it. Registered when addons/index.js loads.
 */

import { registerAddon } from '../registry.js';
import { isOdooIntegrationEnabled } from './connection.js';
import { odooRoutes } from './routes.js';
import { ODOO_CONTENT_SCHEMA, ODOO_USER_SCHEMA } from './schema.js';
import {
    pauseSyncsRunBy, resumeSyncsRunBy, scheduleSyncRunsAfterChanges, triggerDailyReconcile,
} from './syncScheduler.js';

/** Switching off pauses the person's syncs; on resumes them. */
export const odooAddon = Object.freeze({
    id: 'odoo',
    name: 'Odoo',
    description: 'Send Documents to your Odoo as PDFs or Knowledge articles, or keep a folder in sync with Knowledge. What you send leaves Panino and appears in Odoo under your Odoo user.',
    isOffered: isOdooIntegrationEnabled,
    onDisabled: (userId) => pauseSyncsRunBy(userId, 'addon_disabled'),
    onEnabled: (userId) => resumeSyncsRunBy(userId, 'addon_disabled'),
    routes: odooRoutes,
    schema: { user: ODOO_USER_SCHEMA, content: ODOO_CONTENT_SCHEMA },
    hooks: {
        // A synced folder or Document mirrors to Odoo Knowledge a while after the last change.
        afterChangesApplied: scheduleSyncRunsAfterChanges,
        afterSyncRequest: triggerDailyReconcile,
    },
    configWarnings: () => (
        process.env.ODOO_INTEGRATION_ENABLED === 'true' && !isOdooIntegrationEnabled()
            ? ['ODOO_INTEGRATION_ENABLED is true but ODOO_CREDENTIAL_ENCRYPTION_KEY is missing or shorter than 32 characters; the Odoo integration stays off.']
            : []
    ),
});
registerAddon(odooAddon);

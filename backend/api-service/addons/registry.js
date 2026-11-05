/**
 * Add-ons: external service integrations the operator offers and each user
 * switches on for their own account, off by default. Spec:
 * docs/specs/active/addons.md.
 *
 * Each add-on lives in its own folder (addons/<id>/) and registers a manifest
 * when its index.js loads; addons/index.js lists them. Core never imports an
 * add-on: it reaches them through this registry (docs/specs/active/addon-folders.md).
 * Three states, in order:
 *   offered   the manifest's isOffered() (its own env flag and secrets)
 *   enabled   the user's row in the `addons` table (no row: off)
 *   connected the add-on's own business (odoo_connection, …)
 */

import express from 'express';
import { getUserDb, registerAddonSchema } from '../db.js';

export const addonsRoutes = express.Router();

const ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const registry = new Map();

/**
 * The moments in core an add-on can hook into. Each is named after the moment,
 * not after what an add-on does with it. Hooks run synchronously and must
 * return quickly; anything slow is the add-on's to defer.
 *   afterChangesApplied(dbKey)  a /sync push committed changes to a database
 *   afterSyncRequest(dbKey)     a /sync request for a database finished
 */
export const ADDON_HOOKS = Object.freeze(['afterChangesApplied', 'afterSyncRequest']);

/**
 * Register an add-on. Called once by the add-on's index.js.
 *
 * @param {{ id: string, name: string, description: string, isOffered: () => boolean,
 *   onEnabled?: (userId: string) => (void | Promise<void>),
 *   onDisabled?: (userId: string) => (void | Promise<void>),
 *   routes?: import('express').Router,
 *   publicRoutes?: import('express').Router,
 *   schema?: { user?: string, content?: string, upgrade?: (db: any, kind: string) => void },
 *   hooks?: Record<string, (...args: any[]) => void>,
 *   configWarnings?: () => string[] }} manifest
 *   `routes` are mounted at /addons/<id> behind requireAddon(id), with paths
 *   relative to that prefix. `publicRoutes` are mounted at the same prefix before
 *   sign-in is checked, behind the offered check only: they are for a browser
 *   coming back from the service (an OAuth callback), which carries no Panino
 *   token, so each must authenticate the request itself and check
 *   isAddonEnabled. `schema.user` runs on user databases, `schema.content`
 *   on every content database (user and space); both must be idempotent and
 *   server-only. `configWarnings` lists operator misconfigurations to log at startup.
 */
export function registerAddon(manifest) {
    if (!manifest || !ID_PATTERN.test(String(manifest.id || ''))) {
        throw new Error('An add-on needs an id of lower-case letters, digits and dashes');
    }
    if (typeof manifest.isOffered !== 'function') throw new Error(`Add-on ${manifest.id} needs isOffered()`);
    if (!manifest.name) throw new Error(`Add-on ${manifest.id} needs a name`);
    for (const key of ['routes', 'publicRoutes']) {
        if (manifest[key] && typeof manifest[key] !== 'function') throw new Error(`Add-on ${manifest.id}: ${key} must be a Router`);
    }
    for (const name of Object.keys(manifest.hooks || {})) {
        if (!ADDON_HOOKS.includes(name)) throw new Error(`Add-on ${manifest.id}: unknown hook ${name}`);
    }
    if (manifest.schema) registerAddonSchema(manifest.id, manifest.schema);
    registry.set(manifest.id, Object.freeze({
        description: '', onEnabled: null, onDisabled: null, routes: null, publicRoutes: null, hooks: {}, configWarnings: null, ...manifest,
    }));
}

/**
 * Mount every registered add-on's routes at /addons/<id>, behind the gate. The
 * gate is part of the mount, so an add-on cannot add a route that skips it.
 * Call after addonsRoutes, which owns PUT /addons/:id/enabled.
 *
 * @param {import('express').Express} app
 */
export function mountAddonRoutes(app) {
    for (const addon of listAddons()) {
        if (addon.routes) app.use(`/addons/${addon.id}`, requireAddon(addon.id), addon.routes);
    }
}

/**
 * Mount every registered add-on's public routes at /addons/<id>. Call before
 * authenticateToken. Only the offered check runs here; a public route signs the
 * caller in from its own proof (an OAuth `state`) and checks the switch itself.
 *
 * @param {import('express').Express} app
 */
export function mountAddonPublicRoutes(app) {
    for (const addon of listAddons()) {
        if (addon.publicRoutes) app.use(`/addons/${addon.id}`, requireOffered(addon.id), addon.publicRoutes);
    }
}

/** 404 while the operator does not offer the add-on, so the server does not reveal it. */
function requireOffered(id) {
    return (req, res, next) => {
        const addon = getAddon(id);
        if (!addon || addon.isOffered() !== true) return res.status(404).json({ error: 'Not found' });
        return next();
    };
}

/**
 * Run a hook on every registered add-on the operator offers. A throwing hook is
 * logged and never reaches the caller: a sync must not fail because of an add-on.
 * Per-user enablement is the add-on's own check.
 */
export function runAddonHooks(name, ...args) {
    for (const addon of offeredAddons()) {
        const hook = addon.hooks[name];
        if (typeof hook !== 'function') continue;
        try {
            hook(...args);
        } catch (error) {
            console.error(`[addons] ${name} failed for ${addon.id}:`, error);
        }
    }
}

/** Operator misconfigurations the registered add-ons report, prefixed with their id. */
export function addonConfigWarnings() {
    return listAddons().flatMap((addon) => {
        const warnings = typeof addon.configWarnings === 'function' ? addon.configWarnings() : [];
        return (warnings || []).map((warning) => `[addons:${addon.id}] ${warning}`);
    });
}

/** @returns {object|null} */
export function getAddon(id) {
    return registry.get(String(id)) || null;
}

/** Every registered add-on, offered or not. */
export function listAddons() {
    return [...registry.values()];
}

/** The add-ons the operator has switched on for this server. */
export function offeredAddons() {
    return listAddons().filter((addon) => addon.isOffered() === true);
}

/** The user's switch for one add-on, or null when they never touched it. */
export function readAddonRow(userId, id) {
    return getUserDb(userId)
        .prepare('SELECT addon_id, enabled, enabled_at, disabled_at FROM addons WHERE addon_id = ?')
        .get(String(id)) || null;
}

/** @returns {boolean} whether the user switched the add-on on */
export function isAddonEnabled(userId, id) {
    return readAddonRow(userId, id)?.enabled === 1;
}

/** @returns {boolean} offered by the operator and switched on by the user */
export function isAddonActive(userId, id) {
    const addon = getAddon(id);
    return Boolean(addon && addon.isOffered() === true && isAddonEnabled(userId, id));
}

/**
 * Store the user's switch. Runs the manifest's hook when the state changed; a
 * failing hook is logged, the switch stays stored.
 *
 * @returns {Promise<{ changed: boolean, row: object }>}
 */
export async function setAddonEnabled(userId, id, enabled) {
    const addon = getAddon(id);
    if (!addon) throw new Error(`Unknown add-on ${id}`);
    const db = getUserDb(userId);
    const before = readAddonRow(userId, id)?.enabled === 1;
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO addons (addon_id, enabled, enabled_at, disabled_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(addon_id) DO UPDATE SET
            enabled = excluded.enabled,
            enabled_at = CASE WHEN excluded.enabled = 1 AND addons.enabled = 0 THEN excluded.enabled_at ELSE addons.enabled_at END,
            disabled_at = CASE WHEN excluded.enabled = 0 AND addons.enabled = 1 THEN excluded.disabled_at ELSE addons.disabled_at END
    `).run(id, enabled ? 1 : 0, enabled ? now : null, enabled ? null : now);
    const changed = before !== enabled;
    if (changed) {
        const hook = enabled ? addon.onEnabled : addon.onDisabled;
        if (typeof hook === 'function') {
            try {
                await hook(userId);
            } catch (error) {
                console.error(`[addons] ${enabled ? 'onEnabled' : 'onDisabled'} failed for ${id}:`, error);
            }
        }
    }
    return { changed, row: readAddonRow(userId, id) };
}

/**
 * The gate every add-on route sits behind: 404 while the operator does not offer
 * the add-on (the server does not reveal it), 403 `addon_disabled` until the
 * caller switches it on.
 */
export function requireAddon(id) {
    return (req, res, next) => {
        const addon = getAddon(id);
        if (!addon || addon.isOffered() !== true) return res.status(404).json({ error: 'Not found' });
        const userId = req.user?.user_id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!isAddonEnabled(userId, id)) {
            return res.status(403).json({
                error: 'addon_disabled',
                message: `Turn on ${addon.name} in Settings → Add-ons first.`,
            });
        }
        return next();
    };
}

function entryPayload(addon, row) {
    return {
        id: addon.id,
        name: addon.name,
        description: addon.description,
        enabled: row?.enabled === 1,
        enabledAt: row?.enabled_at || null,
    };
}

addonsRoutes.get('/addons', (req, res) => {
    try {
        const userId = req.user.user_id;
        res.json({ addons: offeredAddons().map((addon) => entryPayload(addon, readAddonRow(userId, addon.id))) });
    } catch (error) {
        console.error('[addons] Failed to list add-ons:', error);
        res.status(500).json({ error: 'Failed to load add-ons' });
    }
});

addonsRoutes.put('/addons/:id/enabled', async (req, res) => {
    const addon = getAddon(req.params.id);
    if (!addon || addon.isOffered() !== true) return res.status(404).json({ error: 'Not found' });
    if (typeof req.body?.enabled !== 'boolean') {
        return res.status(400).json({ error: 'invalid', message: 'Say whether the add-on is on or off.' });
    }
    try {
        const { row } = await setAddonEnabled(req.user.user_id, addon.id, req.body.enabled);
        res.json(entryPayload(addon, row));
    } catch (error) {
        console.error('[addons] Failed to switch an add-on:', error);
        res.status(500).json({ error: 'Failed to update the add-on' });
    }
});

/**
 * The add-ons that ship with this app, one import per add-on
 * (docs/specs/active/addon-folders.md). A manifest says how an add-on appears;
 * whether it is offered and on is the server's answer (addonsStore). Core
 * components read manifests from here and never import an add-on directly.
 *
 * Manifests import their components lazily (`() => import(…)`), so an add-on
 * that is off adds nothing to the main bundle but its manifest and icons.
 */
import github from './github/manifest.js'
import odoo from './odoo/manifest.js'

export const ADDON_MANIFESTS = Object.freeze([github, odoo])

/** @returns {object|null} the manifest with this id */
export function addonManifest(id) {
    return ADDON_MANIFESTS.find((manifest) => manifest.id === id) || null
}

/** @returns {object[]} the manifests that contribute to a point, such as 'actions' or 'spaceCard' */
export function addonsContributing(point) {
    return ADDON_MANIFESTS.filter((manifest) => {
        const value = manifest[point]
        return Array.isArray(value) ? value.length > 0 : Boolean(value)
    })
}

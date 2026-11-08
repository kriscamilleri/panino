// Building blocks for the v1 REST routes (docs/specs/active/llm-api.md §7): the
// operation context, query and body reading, and one error mapping. Each area
// file in this folder registers its routes with them; restRoutes.js mounts them.
import { isDatabaseBusyError, respondDatabaseBusy } from '../../../db.js';
import { ApiError } from '../serviceCore.js';

/** The context every operation takes. */
export function context(req) {
    return { userId: req.user.user_id, agent: req.agent, clients: req.clients };
}

/** The first value of a query parameter that may repeat. */
export function first(value) {
    return Array.isArray(value) ? value[0] : value;
}

/** `space` from the query string, else from a JSON body. */
export function spaceParam(req) {
    const fromQuery = first(req.query.space);
    if (fromQuery !== undefined) return fromQuery;
    return req.body && typeof req.body === 'object' ? req.body.space : undefined;
}

/** The JSON body, or an empty object. */
export function body(req) {
    return req.body && typeof req.body === 'object' ? req.body : {};
}

/** A boolean query parameter: "true" or "1" is true, anything else false. */
export function flag(req, name) {
    const value = first(req.query[name]);
    return value === 'true' || value === '1';
}

/** `includeTrash` from the query string. */
export function wantsTrash(req) {
    return flag(req, 'includeTrash');
}

/**
 * Wrap a route: ApiError becomes its status and closed code, a busy database a
 * 503, anything else a 500 with nothing of the error in the response.
 * The function may be async.
 */
export function handler(fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        } catch (error) {
            if (res.headersSent) return undefined;
            if (error instanceof ApiError) {
                return res.status(error.status).json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) });
            }
            if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
            console.error('[ai:v1]', req.method, req.route?.path, error?.code || error?.message || 'unknown error');
            return res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
        }
    };
}

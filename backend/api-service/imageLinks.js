// /backend/api-service/imageLinks.js

const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const IMAGE_PATH_PATTERN = new RegExp(`^((?:/api)?)/images/(${UUID_SOURCE})$`, "i");
const KNOWN_PARAMETERS = new Set(["space", "token"]);

/**
 * Settings whose origin serves this installation's own images. In production
 * the API sits under the frontend's origin (`/api`), in development it has its
 * own, and the PDF renderer reaches it through a third.
 */
export const INTERNAL_IMAGE_ORIGIN_VARIABLES = ["INTERNAL_API_URL", "PUBLIC_API_BASE_URL", "FRONTEND_URL"];

function originOf(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Read a link as a reference to one of this installation's stored images.
 *
 * The editor writes these links in three forms depending on where it runs:
 * `/images/<id>`, `/api/images/<id>` (production), and an absolute URL on the
 * API's origin (development). All three are the same image. A link to any
 * other origin, or with a path that is not an image, is not ours: null.
 *
 * @param {string} source the link destination as written in Markdown or HTML
 * @returns {{
 *   imageId: string,
 *   spaceId: string | null,
 *   prefix: string,
 *   extraParameters: boolean,
 * } | null}
 *   `prefix` is everything before `/images/<id>` (origin and `/api`, if any),
 *   so a rewritten link can keep the form it was written in. `extraParameters`
 *   is true when the query carries anything besides `space` and `token`.
 */
export function parseInternalImageLink(source) {
  try {
    const decoded = String(source).replace(/&amp;/gi, "&");
    // "//host/path" starts with a slash but names another host.
    const relative = decoded.startsWith("/") && !decoded.startsWith("//");
    const parsed = new URL(decoded, "http://panino-internal.invalid");
    if (!relative) {
      const allowedOrigins = new Set(INTERNAL_IMAGE_ORIGIN_VARIABLES
        .map((name) => originOf(process.env[name]))
        .filter(Boolean));
      if (!allowedOrigins.has(parsed.origin)) return null;
    }
    const match = IMAGE_PATH_PATTERN.exec(parsed.pathname);
    if (!match) return null;
    const spaces = parsed.searchParams.getAll("space");
    if (spaces.length > 1) return null;
    return {
      imageId: match[2].toLowerCase(),
      spaceId: spaces[0] ? spaces[0].toLowerCase() : null,
      prefix: `${relative ? "" : parsed.origin}${match[1]}`,
      extraParameters: [...parsed.searchParams.keys()].some((key) => !KNOWN_PARAMETERS.has(key)),
    };
  } catch {
    return null;
  }
}

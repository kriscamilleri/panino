// frontend/src/utils/googleFontTtf.js

/**
 * Runtime helper that always returns direct `.ttf` URLs for the
 * requested Google Font family by querying the public
 * "google-webfonts-helper" JSON API.
 *
 * @param {string} family   e.g. "Roboto" or "Open Sans"
 * @param {string[]} variants  defaults to the four most common
 * @param {string[]} subsets   defaults to ["latin"]
 * @returns {Promise<Array<{ family:string, weight:string, style:string, url:string }>>}
 */
export async function fetchGoogleFontTtf(
    family,
    variants = ['regular', '700', 'italic', '700italic'],
    subsets = ['latin'],
) {

    const isProduction = import.meta.env.PROD
    const devFontServiceUrl =
        import.meta.env.VITE_FONT_SERVICE_URL || 'http://localhost:3002'
    const fontServiceUrl = isProduction ? '' : devFontServiceUrl

    const id = family.trim().toLowerCase().replace(/\s+/g, '-');
    const url = `${fontServiceUrl}/gwf/${id}?variants=${variants.join(',')}&subsets=${subsets.join(',')}&formats=ttf`;

    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) {
        throw new Error(`gwfh error: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();           // API response schema:
    // https://github.com/majodev/google-webfonts-helper#api
    return json.variants.map(v => ({
        family: json.family,   // "Roboto", "Inter" ...
        weight: v.fontWeight,  // "400" | "700" | ...
        style: v.fontStyle,   // "normal" | "italic"
        url: v.ttf,         // direct .ttf URL
    }));
}
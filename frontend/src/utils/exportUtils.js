// /frontend/src/utils/exportUtils.js
// Pure utility functions for import/export — extracted for testability.

/** UUID v4 regex fragment (8-4-4-4-12 hex). */
const UUID_RE = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

/**
 * Replace image URL references in markdown content using an old→new ID map.
 * Handles both production (`/api/images/{id}`) and dev (`http://…/images/{id}`) URLs.
 */
export function replaceImageReferences(content, idMapping, buildImageUrl) {
    if (!content || idMapping.size === 0) return content;
    const pattern = new RegExp(`(!\\[[^\\]]*\\]\\()([^)]*\\/images\\/(${UUID_RE}))(\\))`, 'gi');
    return content.replace(pattern, (_match, prefix, _fullUrl, oldId, suffix) => {
        const newId = idMapping.get(oldId);
        if (!newId) return _match;
        return `${prefix}${buildImageUrl(newId)}${suffix}`;
    });
}

/** Convert a Blob to a data-URL string (e.g. data:image/png;base64,...). */
export function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/** Convert a data-URL string back to a Blob. */
export function base64ToBlob(dataUrl) {
    const [header, data] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const binary = atob(data);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        array[i] = binary.charCodeAt(i);
    }
    return new Blob([array], { type: mime });
}

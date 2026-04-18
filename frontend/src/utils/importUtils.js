// /frontend/src/utils/importUtils.js

/**
 * Resource limits for markdown/directory/ZIP imports.
 * Prevents zip bombs and resource exhaustion.
 */
export const IMPORT_LIMITS = {
    MAX_FILES: 10_000,
    MAX_TOTAL_BYTES: 500 * 1024 * 1024,   // 500 MB
    MAX_FILE_BYTES: 50 * 1024 * 1024,      // 50 MB per file
    MAX_DIRECTORIES: 1_000,
};

/**
 * Sanitize a relative file path into safe segments.
 * Strips path traversal (`..`, `.`), drive letters, leading slashes,
 * control characters, and truncates each segment to 500 chars.
 * Normalizes Unicode to NFC form.
 *
 * @param {string} relativePath - The raw relative path (e.g. from ZIP entry or webkitRelativePath)
 * @returns {string[]} Array of clean path segments (may be empty)
 */
export function sanitizePathSegments(relativePath) {
    if (!relativePath || typeof relativePath !== 'string') return [];

    return relativePath
        .normalize('NFC')
        .replace(/^[a-zA-Z]:/, '')              // strip drive letter (C:)
        .split(/[/\\]/)                         // split on / or \
        .filter(seg => seg && seg !== '.' && seg !== '..')
        .map(seg => seg.replace(/[\x00-\x1f]/g, '').slice(0, 500));
}

/**
 * Extract a title from YAML front matter in markdown content.
 * Only scans the first 4 KB for performance.
 * Front matter must start at byte 0 and be delimited by `---`.
 *
 * @param {string} content - The full markdown content
 * @returns {string|null} The title if found, or null
 */
export function extractTitleFromFrontMatter(content) {
    if (!content || typeof content !== 'string') return null;

    // Only scan the first 4 KB
    const head = content.slice(0, 4096);
    const match = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;

    const titleMatch = match[1].match(/^title:\s*(.+)$/m);
    if (!titleMatch) return null;

    const title = titleMatch[1].trim().replace(/^['"]|['"]$/g, '');
    if (!title) return null;

    // Sanitize: NFC normalize, strip control chars, truncate
    return title.normalize('NFC').replace(/[\x00-\x1f]/g, '').slice(0, 500) || null;
}

/**
 * Derive a note title from a filename.
 * Strips .md/.markdown extension. Returns "Untitled" for empty results.
 *
 * @param {string} filename - The filename (e.g. "my-note.md")
 * @returns {string} The derived title
 */
export function titleFromFilename(filename) {
    if (!filename || typeof filename !== 'string') return 'Untitled';
    const title = filename.replace(/\.(md|markdown)$/i, '').trim();
    return title || 'Untitled';
}

/**
 * Deduplicate a name against a set of existing names.
 * If `name` is in `existingNames`, appends `(import N)` until unique.
 *
 * @param {string} name - The candidate name
 * @param {Set<string>} existingNames - Set of names already taken
 * @returns {string} A unique name (original or with suffix)
 */
export function deduplicateName(name, existingNames) {
    if (!existingNames.has(name)) return name;

    let counter = 1;
    let candidate;
    do {
        candidate = `${name} (import ${counter})`;
        counter++;
    } while (existingNames.has(candidate) && counter < 1000);

    return candidate;
}

/**
 * Check whether a file path has a markdown extension.
 *
 * @param {string} path - File path or name
 * @returns {boolean}
 */
export function isMarkdownFile(path) {
    if (!path || typeof path !== 'string') return false;
    return /\.(md|markdown)$/i.test(path);
}

/**
 * Check whether a path segment represents a hidden file/directory
 * (starts with `.` or `__`).
 *
 * @param {string} segment - A single path segment
 * @returns {boolean}
 */
export function isHiddenSegment(segment) {
    if (!segment) return false;
    return segment.startsWith('.') || segment.startsWith('__');
}

/**
 * Build a folder tree structure from a list of file entries.
 * Each entry has `{ relativePath, content }`.
 * Returns `{ folders, notes }` where:
 * - folders: Map<string, { name, parentPath }> keyed by full path
 * - notes: Array<{ title, content, folderPath }>
 *
 * Hidden files/dirs (starting with `.` or `__`) are skipped.
 * Non-markdown files are skipped.
 *
 * @param {Array<{relativePath: string, content: string}>} entries
 * @returns {{ folders: Map<string, {name: string, parentPath: string|null}>, notes: Array<{title: string, content: string, folderPath: string|null}> }}
 */
export function buildFolderTree(entries) {
    const folders = new Map();  // fullPath -> { name, parentPath }
    const notes = [];

    for (const entry of entries) {
        const segments = sanitizePathSegments(entry.relativePath);
        if (segments.length === 0) continue;

        // Check for hidden segments anywhere in the path
        if (segments.some(isHiddenSegment)) continue;

        const filename = segments[segments.length - 1];
        if (!isMarkdownFile(filename)) continue;

        // Build folder chain (all segments except the last)
        const folderSegments = segments.slice(0, -1);
        let currentPath = null;

        for (let i = 0; i < folderSegments.length; i++) {
            const seg = folderSegments[i];
            const fullPath = currentPath ? `${currentPath}/${seg}` : seg;

            if (!folders.has(fullPath)) {
                folders.set(fullPath, {
                    name: seg,
                    parentPath: currentPath,
                });
            }
            currentPath = fullPath;
        }

        // Derive title from front matter or filename
        const fmTitle = extractTitleFromFrontMatter(entry.content);
        const fnTitle = titleFromFilename(filename);
        const title = fmTitle || fnTitle;

        notes.push({
            title,
            content: entry.content || '',
            folderPath: currentPath,  // null if file is at root
        });
    }

    return { folders, notes };
}

/**
 * Validate file counts and sizes against import limits.
 * Throws an Error with a user-friendly message if limits are exceeded.
 *
 * @param {number} fileCount
 * @param {number} dirCount
 * @param {number} [totalBytes]
 */
export function validateImportLimits(fileCount, dirCount, totalBytes) {
    if (fileCount > IMPORT_LIMITS.MAX_FILES) {
        throw new Error(`This import contains too many files (${fileCount}). Maximum is ${IMPORT_LIMITS.MAX_FILES.toLocaleString()}.`);
    }
    if (dirCount > IMPORT_LIMITS.MAX_DIRECTORIES) {
        throw new Error(`This import contains too many directories (${dirCount}). Maximum is ${IMPORT_LIMITS.MAX_DIRECTORIES.toLocaleString()}.`);
    }
    if (totalBytes !== undefined && totalBytes > IMPORT_LIMITS.MAX_TOTAL_BYTES) {
        throw new Error(`This import exceeds the maximum total size of 500 MB.`);
    }
}

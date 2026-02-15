function normalizeTitle(title) {
    const trimmed = String(title || '').trim();
    return trimmed || 'Untitled';
}

function normalizeFolderName(folderName) {
    const trimmed = String(folderName || '').trim();
    return trimmed || 'Root';
}

function extractExcerpt(content, maxLength = 120) {
    const compact = String(content || '').replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function countWords(content) {
    const words = String(content || '').trim().match(/\S+/g);
    return words ? words.length : 0;
}

export function normalizeRecentDocument(row = {}) {
    return {
        id: row.id,
        type: 'file',
        name: normalizeTitle(row.title),
        folderName: normalizeFolderName(row.folderPath || row.folderName),
        displayedDate: row.updated_at || row.created_at || '',
        excerpt: extractExcerpt(row.content),
        wordCount: countWords(row.content),
    };
}

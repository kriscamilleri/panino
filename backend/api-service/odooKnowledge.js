/**
 * Send a Document to Odoo Knowledge as an article (docs/specs/active/odoo-integration.md
 * §5, §6, §7). The client renders the Markdown the way the Preview does; this module
 * sanitizes it again, turns task lists into Knowledge checklists, drops a leading
 * heading that repeats the title, and replaces images with placeholders (Phase 6
 * uploads them). The first send creates an article under the chosen parent; later
 * sends overwrite that article's name and body, after checking it is still the
 * record Panino created.
 */

import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import { OdooError, odooUrlPath } from './odooClient.js';
import { dropLink, readLink, saveLink } from './odooLinks.js';

const MODEL = 'knowledge.article';
/** Knowledge's own editor keeps roughly this much; anything bigger is refused. */
export const MAX_ARTICLE_HTML_BYTES = 2 * 1024 * 1024;
export const IMAGE_PLACEHOLDER = 'Image not sent';

const window = new JSDOM('').window;
const purify = DOMPurify(window);

const ALLOWED_TAGS = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'sub', 'sup', 'mark', 'span', 'div',
    'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'input', 'dl', 'dt', 'dd', 'figure', 'figcaption',
];
const ALLOWED_ATTR = ['href', 'title', 'alt', 'src', 'class', 'type', 'checked', 'colspan', 'rowspan', 'start', 'lang', 'dir'];

/**
 * The article body for Odoo: sanitized HTML with Knowledge's checklist markup.
 *
 * @param {unknown} html the client's rendered, sanitized Preview HTML
 * @param {string} title the Document's title; a first `<h1>` saying the same is dropped
 * @returns {string}
 */
export function articleBody(html, title) {
    const clean = purify.sanitize(typeof html === 'string' ? html : '', {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        // DOMPurify runs every attribute value through this, not only URLs: a plain word
        // (`checkbox`) must pass, a scheme must be one of these.
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
        FORCE_BODY: true,
    });
    const doc = new window.DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html');
    const { body } = doc;

    // Knowledge shows the article name as its title, so the same heading on top is noise.
    const first = body.firstElementChild;
    if (first && first.tagName === 'H1' && normalizeTitle(first.textContent) === normalizeTitle(title)) {
        first.remove();
    }

    // `- [ ]` lists → Knowledge checklists: <ul class="o_checklist"><li class="o_checked">
    for (const list of body.querySelectorAll('ul.contains-task-list, ol.contains-task-list')) {
        const checklist = doc.createElement('ul');
        checklist.className = 'o_checklist';
        for (const item of [...list.children]) {
            if (item.tagName !== 'LI') continue;
            const box = item.querySelector(':scope > input[type="checkbox"]');
            const li = doc.createElement('li');
            if (box?.hasAttribute('checked')) li.className = 'o_checked';
            box?.remove();
            while (item.firstChild) li.appendChild(item.firstChild);
            if (li.firstChild?.nodeType === 3) li.firstChild.textContent = li.firstChild.textContent.replace(/^\s+/, '');
            checklist.appendChild(li);
        }
        list.replaceWith(checklist);
    }
    // Stray checkboxes outside task lists have no place in an article.
    for (const input of body.querySelectorAll('input')) input.remove();

    // Panino image URLs need a Panino session, so they would break in Odoo (Phase 6 uploads them).
    for (const img of body.querySelectorAll('img')) {
        const placeholder = doc.createElement('span');
        placeholder.className = 'o_panino_image_placeholder';
        placeholder.textContent = img.getAttribute('alt') ? `${IMAGE_PLACEHOLDER}: ${img.getAttribute('alt')}` : IMAGE_PLACEHOLDER;
        img.replaceWith(placeholder);
    }
    for (const anchor of body.querySelectorAll('a[href]')) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
    }
    return body.innerHTML.trim();
}

function normalizeTitle(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Articles for the parent picker, matching `query` by name.
 *
 * @param {ReturnType<import('./odooClient.js').createOdooClient>} client
 * @param {string} query
 * @returns {Promise<{ id: number, name: string, parentName: string|null }[]>}
 */
export async function searchArticles(client, query) {
    const domain = [['is_template', '=', false]];
    if (query) domain.push(['name', 'ilike', query]);
    let rows;
    try {
        rows = await client.call(MODEL, 'search_read', { domain, fields: ['name', 'parent_id'], limit: 20, order: 'write_date desc' });
    } catch (error) {
        // `is_template` only exists from Odoo 18; fall back to the plain search.
        if (!(error instanceof OdooError) || error.code !== 'odoo_error') throw error;
        rows = await client.call(MODEL, 'search_read', { domain: domain.slice(1), fields: ['name', 'parent_id'], limit: 20, order: 'write_date desc' });
    }
    return (Array.isArray(rows) ? rows : []).map((row) => ({
        id: row.id,
        name: String(row.name || '').slice(0, 200),
        parentName: Array.isArray(row.parent_id) ? String(row.parent_id[1] || '').slice(0, 200) : null,
    }));
}

/**
 * @param {object} options
 * @param {ReturnType<import('./odooClient.js').createOdooClient>} options.client the sender's
 * @param {string} options.odooTarget from `odooTarget(connection)`
 * @param {import('better-sqlite3').Database} options.db the Document's database
 * @param {string} options.noteId
 * @param {string} options.title the article name
 * @param {string} options.body from `articleBody`
 * @param {number|null} options.parentId used only when creating; null for the top level
 * @param {string} options.userId the sender
 * @returns {Promise<{ created: boolean, recreated: boolean, recordId: number, urlPath: string|null }>}
 * @throws {OdooError}
 */
export async function sendArticleToKnowledge({ client, odooTarget, db, noteId, title, body, parentId, userId }) {
    const name = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled';
    const key = { sourceId: noteId, destination: 'knowledge', odooTarget };
    const link = readLink(db, key);

    let recreated = false;
    if (link) {
        const rows = await client.call(MODEL, 'read', { ids: [link.odoo_record_id], fields: ['create_date', 'article_url'] });
        const record = Array.isArray(rows) ? rows[0] : null;
        const stillOurs = record && (!link.odoo_create_date || record.create_date === link.odoo_create_date);
        if (stillOurs) {
            await client.call(MODEL, 'write', { ids: [link.odoo_record_id], vals: { name, body } });
            const urlPath = odooUrlPath(record.article_url) || link.odoo_url_path;
            saveLink(db, { ...key, recordId: link.odoo_record_id, createDate: record.create_date, urlPath, userId, now: new Date().toISOString() });
            return { created: false, recreated: false, recordId: link.odoo_record_id, urlPath };
        }
        dropLink(db, key);
        recreated = true;
    }

    const ids = await client.call(MODEL, 'create', {
        vals_list: [{ name, body, parent_id: Number.isInteger(parentId) && parentId > 0 ? parentId : false }],
    });
    const recordId = Array.isArray(ids) ? ids[0] : null;
    if (!Number.isInteger(recordId)) throw new OdooError('odoo_error');
    const rows = await client.call(MODEL, 'read', { ids: [recordId], fields: ['create_date', 'article_url'] });
    const record = Array.isArray(rows) ? rows[0] : null;
    const urlPath = odooUrlPath(record?.article_url) || `/knowledge/article/${recordId}`;
    saveLink(db, { ...key, recordId, createDate: record?.create_date ?? null, urlPath, userId, now: new Date().toISOString() });
    return { created: true, recreated, recordId, urlPath };
}

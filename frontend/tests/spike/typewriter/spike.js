// Phase 0 prototype for docs/specs/active/typewriter-mode.md §12. Throwaway:
// the production code lives in src/utils/typewriter*.js and
// src/composables/useTypewriter.js. Run through the Puppeteer script recorded
// in the agent log; every result lands on window.spike.
import OverType from 'overtype';
import { useOverTypePatches } from '@/composables/useOverTypePatches';

useOverTypePatches();

const COPIED = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontVariantLigatures',
    'letterSpacing', 'lineHeight', 'textTransform', 'textIndent', 'wordSpacing', 'tabSize',
];

export const FIXTURE = [
    '---',
    'title: Spike',
    'author: Kris',
    '---',
    '# Heading one',
    '## Heading two',
    'Setext heading',
    '===',
    '',
    'A paragraph that is long enough to wrap onto more than one visual row in a pane that is six hundred pixels wide, so the mirror has to agree with the highlight layer about where the soft wraps land.',
    '- bullet one',
    '  - nested bullet',
    '    - nested deeper',
    '- [ ] a task',
    '- [x] a done task',
    '1. ordered one',
    '2. ordered two',
    '   continuation line',
    '* star bullet',
    '+ plus bullet',
    '```js',
    'const x = 1;',
    '',
    'function f() { return x; }',
    '```',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '> quote line one',
    '> quote line two',
    '>',
    '> after bare',
    '---',
    '\\pagebreak',
    '    ',
    'https://example.com/a/very/long/url/that/has/no/spaces/at/all/and/keeps/going/and/going/and/going/forever/and/ever/until/it/breaks',
    'tabs\there\tand\tthere',
    '中文文本测试，这是一段很长的中文句子，用来测试换行是否与高亮层一致。中文文本测试，这是一段很长的中文句子，用来测试换行。',
    'Emoji 😀 test 👍🏽 family 👨‍👩‍👧 end',
    'trailing spaces   ',
    '**bold** and _italic_ and `code` and [link](http://x.y/z.md) here',
    '',
    'last line',
].join('\n');

let editor = null;

export function mount(text, { phone = false, width = 640 } = {}) {
    if (editor) editor.destroy();
    document.getElementById('pane').style.width = `${width}px`;
    const host = document.getElementById('host');
    host.innerHTML = '';
    [editor] = OverType.init(host, {
        toolbar: false,
        showStats: false,
        placeholder: 'Start writing...',
        value: text,
        autoResize: true,
        minHeight: '200px',
        ...(phone ? {
            fontFamily: 'ui-monospace, "SF Mono", "IBM Plex Mono", Menlo, Consolas, monospace',
            fontSize: '16px',
            lineHeight: 1.75,
            padding: '16px 20px 96px',
        } : {}),
    });
    editor._updateAutoHeight?.();
    return editor;
}

export function flatten(preview) {
    const out = [];
    for (const child of preview.children) {
        if (child.tagName === 'UL' || child.tagName === 'OL') {
            for (const li of child.children) out.push(li);
        } else {
            out.push(child);
        }
    }
    return out;
}

function lineStartsOf(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    return starts;
}

/** The whole-prefix mirror of caretPosition.js: ground truth for the textarea. */
function prefixMirror(textarea, offset) {
    const style = getComputedStyle(textarea);
    const mirror = document.createElement('div');
    for (const p of COPIED) mirror.style[p] = style[p];
    Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', borderStyle: 'solid' });
    mirror.textContent = textarea.value.slice(0, offset);
    const marker = document.createElement('span');
    marker.textContent = '​';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const r = { top: marker.offsetTop, left: marker.offsetLeft };
    mirror.remove();
    return r;
}

let lineMirror = null;
function oneLineMirror(textarea, lineText, col) {
    if (!lineMirror) {
        lineMirror = document.createElement('div');
        document.body.appendChild(lineMirror);
    }
    const style = getComputedStyle(textarea);
    for (const p of COPIED) lineMirror.style[p] = style[p];
    Object.assign(lineMirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', borderStyle: 'solid', paddingTop: '0px', paddingBottom: '0px', height: 'auto' });
    lineMirror.textContent = lineText.slice(0, col);
    const marker = document.createElement('span');
    marker.textContent = '​';
    lineMirror.appendChild(marker);
    lineMirror.appendChild(document.createTextNode(lineText.slice(col)));
    return { top: marker.offsetTop, left: marker.offsetLeft };
}

function rangeRectAt(el, col) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let remaining = col;
    let node;
    while ((node = walker.nextNode())) {
        if (remaining <= node.length) {
            const range = document.createRange();
            range.setStart(node, remaining);
            range.setEnd(node, Math.min(node.length, remaining + 1));
            const rects = range.getClientRects();
            return rects[0] || range.getBoundingClientRect();
        }
        remaining -= node.length;
    }
    return null;
}

export function runP1P2({ phone = false, width = 640 } = {}) {
    const ed = mount(FIXTURE, { phone, width });
    const { textarea, preview, wrapper } = ed;
    const text = textarea.value;
    const lines = text.split('\n');
    const starts = lineStartsOf(text);
    const els = flatten(preview);
    const p1 = { lineCount: lines.length, elementCount: els.length, topMismatches: [] };
    const padTop = parseFloat(getComputedStyle(textarea).paddingTop);
    const wrapperRect = wrapper.getBoundingClientRect();
    const p2 = { samples: 0, mirrorVsPrefix: [], mirrorVsRange: [], textMismatch: [] };
    els.forEach((el, i) => {
        if (i >= lines.length) return;
        const truth = prefixMirror(textarea, starts[i]);
        if (Math.abs(truth.top - el.offsetTop) > 1) p1.topMismatches.push({ i, line: lines[i].slice(0, 30), elTop: el.offsetTop, mirrorTop: truth.top });
        const line = lines[i];
        const cols = new Set([0, Math.floor(line.length / 3), Math.floor(line.length / 2), Math.floor((2 * line.length) / 3), line.length]);
        for (const col of cols) {
            p2.samples += 1;
            const m = oneLineMirror(textarea, line, col);
            const predicted = { top: el.offsetTop + m.top, left: m.left };
            const prefix = prefixMirror(textarea, starts[i] + col);
            if (Math.abs(prefix.top - predicted.top) > 1 || Math.abs(prefix.left - predicted.left) > 1) {
                p2.mirrorVsPrefix.push({ i, col, predicted, prefix });
            }
            const rendered = el.textContent.replace(/\u00a0/g, ' ');
            if (rendered !== line) {
                if (col === 0) p2.textMismatch.push({ i, line: line.slice(0, 30), rendered: rendered.slice(0, 30) });
                continue;
            }
            if (col >= line.length) continue;
            const rect = rangeRectAt(el, col);
            if (!rect) continue;
            const got = { top: rect.top - wrapperRect.top, left: rect.left - wrapperRect.left };
            // The Range rect top is the line box top inside the row: compare rows by floor.
            const rh = parseFloat(getComputedStyle(textarea).lineHeight);
            const rowPred = Math.round((predicted.top - padTop) / rh);
            const rowGot = Math.floor((got.top - padTop + 1) / rh);
            if (rowPred !== rowGot || Math.abs(got.left - predicted.left) > 1) {
                p2.mirrorVsRange.push({ i, col, predicted, got, rowPred, rowGot });
            }
        }
    });
    return { p1, p2, rowHeight: getComputedStyle(textarea).lineHeight, padTop };
}

function percentile(values, p) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function measureCaret(ed, offset) {
    const { textarea, preview } = ed;
    const text = textarea.value;
    // line index by scanning (the production code keeps a line-start index)
    let lineStart = text.lastIndexOf('\n', offset - 1) + 1;
    let lineEnd = text.indexOf('\n', offset);
    if (lineEnd === -1) lineEnd = text.length;
    let lineIndex = 0;
    for (let i = 0; i < lineStart; i += 1) if (text.charCodeAt(i) === 10) lineIndex += 1;
    const els = flatten(preview);
    const el = els[lineIndex];
    const m = oneLineMirror(textarea, text.slice(lineStart, lineEnd), offset - lineStart);
    return el.offsetTop + m.top;
}

export function runP6() {
    const results = {};
    const sentence = 'The quick brown fox jumps over the lazy dog, again and again. ';
    const docs = {
        lines4000: Array.from({ length: 4000 }, (_, i) => (i % 7 === 0 ? '' : `${i} ${sentence.slice(0, 40)}`)).join('\n'),
        mb1: Array.from({ length: 20000 }, (_, i) => (i % 9 === 0 ? '' : `${sentence}`.slice(0, 50))).join('\n'),
        longLine: `${sentence.repeat(Math.ceil(50000 / sentence.length)).slice(0, 50000)}\nnext`,
    };
    for (const [name, doc] of Object.entries(docs)) {
        const ed = mount(doc);
        const { textarea } = ed;
        const offset = Math.floor(doc.length / 2);
        textarea.focus();
        textarea.setSelectionRange(offset, offset);
        const baseline = [];
        const ours = [];
        for (let k = 0; k < 15; k += 1) {
            // OverType's own per-keystroke work: value change + rebuild + autoheight
            const t0 = performance.now();
            textarea.value = textarea.value.slice(0, offset) + 'x' + textarea.value.slice(offset);
            textarea.setSelectionRange(offset + 1, offset + 1);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            void textarea.offsetHeight; // flush the layout the browser would do anyway
            const t1 = performance.now();
            measureCaret(ed, offset + 1);
            const t2 = performance.now();
            baseline.push(t1 - t0);
            ours.push(t2 - t1);
        }
        results[name] = {
            chars: doc.length,
            baselineP50: percentile(baseline, 50), baselineP95: percentile(baseline, 95),
            oursP50: percentile(ours, 50), oursP95: percentile(ours, 95),
        };
    }
    return results;
}

export function runP8() {
    const doc = Array.from({ length: 300 }, (_, i) => `line ${i}${i === 250 ? ' term' : ''}`).join('\n');
    const ed = mount(doc);
    const pane = document.getElementById('pane');
    pane.scrollTop = 0;
    const { textarea } = ed;
    const idx = doc.indexOf('term');
    // Editor.vue's findNext, verbatim in effect.
    textarea.focus();
    textarea.setSelectionRange(idx, idx + 4);
    const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
    const lineNumber = doc.substring(0, idx).split('\n').length;
    textarea.scrollTop = Math.max(0, (lineNumber - 5) * lineHeight);
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
        resolve({ paneScrollTopAfterFindNext: pane.scrollTop, textareaScrollTop: textarea.scrollTop, caretTop: measureCaret(ed, idx), paneHeight: pane.clientHeight });
    })));
}

/** P4 and P10 are driven by real key presses from Puppeteer; this records what happens. */
export function prepareP4P10() {
    const doc = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const ed = mount(doc);
    const pane = document.getElementById('pane');
    const { textarea } = ed;
    const log = [];
    pane.addEventListener('scroll', () => log.push({ type: 'scroll', t: performance.now(), top: pane.scrollTop }));
    textarea.addEventListener('input', () => log.push({ type: 'input', t: performance.now(), top: pane.scrollTop }));
    textarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
            e.preventDefault();
            log.push({ type: 'shortcut', t: performance.now(), value: textarea.value.length });
        }
    });
    // Caret at the start of line 40, the pane scrolled so that line is the last visible row.
    const offset = doc.indexOf('line 40\n');
    textarea.focus();
    textarea.setSelectionRange(offset, offset);
    const caretTop = measureCaret(ed, offset);
    pane.scrollTop = Math.max(0, caretTop - pane.clientHeight + 30);
    log.length = 0;
    return { valueLength: textarea.value.length, startTop: pane.scrollTop, caretTop, log };
}

window.spike = { mount, runP1P2, runP6, runP8, prepareP4P10, FIXTURE, get editor() { return editor; } };
window.spikeReady = true;

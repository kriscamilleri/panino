/* global window, document, location, localStorage, getComputedStyle, HTMLTextAreaElement, Event, setTimeout, console, process, fetch */
// Headless browser check for the TOC and internal links feature against a scratch stack
// (Vite on 5182, API container on 8012). Writes screenshots to the worktree's log assets.
import { createRequire } from 'node:module'
import fs from 'node:fs'

const WORKTREE = '/home/kris/Development/panino/.claude/worktrees/agent-a5af9b3a3b4542570'
const require = createRequire(`${WORKTREE}/backend/api-service/package.json`)
const puppeteer = require('puppeteer')
const APP = 'http://127.0.0.1:5182'
const API = 'http://127.0.0.1:8012'
const ASSETS = `${WORKTREE}/docs/agent-logs/2026/11/toc-assets`
fs.mkdirSync(ASSETS, { recursive: true })

const results = []
function record(name, ok, detail = '') {
    results.push({ name, ok, detail })
    console.info(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const email = `toc-${Date.now()}@example.test`
const signup = await fetch(`${API}/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: email, email, password: 'password123' }) })
const { token } = await signup.json()

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
process.on('exit', () => { if (consoleErrors?.length) console.info('console errors:', consoleErrors.slice(0, 10).join('\n')) })
const page = await browser.newPage()
const consoleErrors = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
let dialogs = 0
page.on('dialog', async (dialog) => { dialogs += 1; await dialog.dismiss() })
await page.evaluateOnNewDocument((jwt) => {
    if (location.protocol === 'about:') return
    localStorage.setItem('jwt_token', jwt)
    const original = window.fetch
    window.__pdfBodies = []
    window.fetch = async (input, init) => {
        if (String(input).includes('/render-pdf') && init?.body) window.__pdfBodies.push(String(init.body))
        return original(input, init)
    }
}, token)
await page.setViewport({ width: 1280, height: 900 })
await page.goto(`${APP}/#/`, { waitUntil: 'networkidle2' })
await page.waitForSelector('[data-testid="homepage-main-content"]', { timeout: 30000 })

const stores = (fn, ...args) => page.evaluate(fn, ...args)
const ids = await stores(async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const sync = pinia._s.get('syncStore')
    const docs = pinia._s.get('docStore')
    const dbKey = sync.personalDbKey
    const a = await docs.createFile(dbKey, 'Plan', null, { content: '# Plan\n\nIntro text.\n\n## Intro\n\n### Background\n\nSome background.\n\n## Budget\n\nMoney.\n' })
    const b = await docs.createFile(dbKey, 'Project plan', null, { content: '# Project plan\n\n## Budget\n\nNumbers.\n\n## Risks\n' })
    pinia._s.get('uiStore').showActionBar = true
    return { a: a.id, b: b.id, dbKey }
})
const textarea = '[data-testid="editor-container"] textarea'
const value = () => page.$eval(textarea, (el) => el.value)
async function setText(text) {
    await page.$eval(textarea, (el, next) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        setter.call(el, next)
        el.dispatchEvent(new Event('input', { bubbles: true }))
    }, text)
}
async function caretToEnd() {
    await page.$eval(textarea, (el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length) })
}

await page.evaluate((id, dbKey) => { location.hash = `#/doc/${id}?dbKey=${dbKey}` }, ids.a, ids.dbKey)
await page.waitForSelector(textarea)
await sleep(800)

// U1: Insert from the toolbar, editor never focused → after the leading H1.
await page.click('[data-testid="submenu-editor-toc"]')
await page.waitForSelector('[data-testid="submenu-editor-toc-insert"]')
await page.click('[data-testid="submenu-editor-toc-insert"]')
await sleep(700)
let text = await value()
record('U1 marker and outline numbers written after the H1', text.startsWith('# Plan\n\n<!-- panino:toc {"v":1,"min":2,"max":3} -->\n**Contents**\n\n- 1 [Intro](#intro)\n  - 1.1 [Background](#background)\n- 2 [Budget](#budget)\n<!-- /panino:toc -->'), JSON.stringify(text.slice(0, 160)))
const tocStyle = await page.evaluate(() => {
    const ul = document.querySelector('[data-testid="preview-content"] nav.pn-toc.pn-toc-numbered ul')
    const nested = ul?.querySelector('ul')
    return ul && { list: getComputedStyle(ul).listStyleType, nestedTop: nested ? getComputedStyle(nested).marginTop : null }
})
record('U1 Preview list has no bullets and no nested gaps', tocStyle?.list === 'none' && tocStyle?.nestedTop === '0px', JSON.stringify(tocStyle))
await page.screenshot({ path: `${ASSETS}/u1-desktop-toc-inserted.png` })

// U2: click Background in the table; the route stays.
const hashBefore = await page.evaluate(() => location.hash)
await page.click('[data-testid="preview-content"] nav a[href="#pn-background"]')
await sleep(300)
const afterClick = await page.evaluate(() => ({ hash: location.hash, active: document.activeElement?.id }))
record('U2 heading link scrolls without routing', afterClick.hash === hashBefore && afterClick.active === 'pn-background', JSON.stringify(afterClick))

// U3: add a heading, the stale bar shows, Refresh fixes it, one Undo restores.
await setText(`${await value()}\n## Risks\n`)
await sleep(900)
const staleShown = await page.$('[data-testid="preview-toc-stale"]')
record('U3 stale bar within a second', Boolean(staleShown))
await page.screenshot({ path: `${ASSETS}/u3-desktop-stale-bar.png` })
await page.click('[data-testid="preview-toc-refresh"]')
await sleep(700)
text = await value()
record('U3 Refresh lists Risks and the bar goes', text.includes('- 3 [Risks](#risks)') && !(await page.$('[data-testid="preview-toc-stale"]')))
await page.click('[data-testid="submenu-editor-undo"]')
await sleep(500)
record('U3 one Undo restores the old table', !(await value()).includes('- 3 [Risks](#risks)'))
await page.click('[data-testid="submenu-editor-redo"]')
await sleep(500)

// U7: [[#bud → Enter writes a heading link.
await caretToEnd()
await page.keyboard.type('\nSee [[#bud')
await page.waitForSelector('[data-testid="link-picker-popover"] [data-testid="link-picker-row-0"]', { timeout: 5000 }).catch(() => null)
await page.screenshot({ path: `${ASSETS}/u7-desktop-wikilink-headings.png` })
await page.keyboard.press('Enter')
await sleep(400)
record('U7 [[#bud writes [Budget](#budget)', (await value()).includes('See [Budget](#budget)'), JSON.stringify((await value()).slice(-40)))

// U8: [[proj → Enter writes a Document link; clicking it opens the Document; Back returns.
await caretToEnd()
await page.keyboard.type(' and [[proj')
await page.waitForFunction(() => document.querySelector('[data-testid="link-picker-row-0"]')?.textContent.includes('Project plan'), { timeout: 5000 }).catch(() => null)
await page.screenshot({ path: `${ASSETS}/u8-desktop-wikilink-documents.png` })
await page.keyboard.press('Enter')
await sleep(400)
record('U8 [[proj writes a panino:doc link', (await value()).includes(`[Project plan](panino:doc/${ids.b})`))
await sleep(900)
const docLinkTitle = await page.$eval(`[data-testid="preview-content"] a[data-pn-doc="${ids.b}"]`, (a) => a.title).catch(() => null)
record('U10 tooltip shows the current title and location', docLinkTitle === 'Project plan — No folder', String(docLinkTitle))
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Not now')?.click())
const hit = await page.evaluate((id) => {
    const a = document.querySelector(`[data-testid="preview-content"] a[data-pn-doc="${id}"]`)
    const r = a.getBoundingClientRect()
    a.scrollIntoView({ block: 'center' })
    const r2 = a.getBoundingClientRect()
    const top = document.elementFromPoint(r2.left + 2, r2.top + r2.height / 2)
    return { covered: top !== a && !a.contains(top), topTag: top?.outerHTML?.slice(0, 120), r }
}, ids.b)
console.info('hit test', JSON.stringify(hit))
await page.evaluate((id) => document.querySelector(`[data-testid="preview-content"] a[data-pn-doc="${id}"]`).click(), ids.b)
await sleep(1500)
const opened = await page.evaluate(() => location.hash)
record('U8 Document link opens the other Document with dbKey', opened.startsWith(`#/doc/${ids.b}?`) && opened.includes('dbKey='), opened)
await page.goBack()
await sleep(1200)
record('U8 Back returns to the first Document', (await page.evaluate(() => location.hash)).startsWith(`#/doc/${ids.a}`))

// U9: a link to a heading in another Document opens scrolled to it.
await page.waitForSelector(textarea)
await caretToEnd()
await page.keyboard.type(' [[Project plan#bud')
await page.waitForFunction(() => document.querySelector('[data-testid="link-picker-row-0"]')?.textContent.includes('Budget'), { timeout: 5000 }).catch(() => null)
console.info('U9 debug', JSON.stringify(await page.evaluate(() => ({
    popover: document.querySelector('[data-testid="link-picker-popover"]')?.innerText,
    tail: document.querySelector('[data-testid="editor-container"] textarea').value.slice(-60),
}))))
await page.screenshot({ path: `${ASSETS}/u9-desktop-document-headings.png` })
await page.keyboard.press('Enter')
await sleep(400)
record('U9 Document then # writes a heading link', (await value()).includes(`[Budget](panino:doc/${ids.b}#budget)`))
await sleep(900)
await page.evaluate((id) => document.querySelector(`[data-testid="preview-content"] a[data-pn-doc="${id}"][data-pn-heading="budget"]`).click(), ids.b)
await sleep(1500)
const arrived = await page.evaluate(() => ({ hash: location.hash, active: document.activeElement?.id }))
record('U9 opens at the heading', arrived.hash.includes('heading=budget') && arrived.active === 'pn-budget', JSON.stringify(arrived))
await page.goBack()
await sleep(1200)

// U13: Ctrl+K with a selection opens the picker with it as label; Escape closes.
await page.waitForSelector(textarea)
await page.$eval(textarea, (el) => { const at = el.value.indexOf('Some background'); el.focus(); el.setSelectionRange(at, at + 4) })
await page.keyboard.down('Control')
await page.keyboard.press('k')
await page.keyboard.up('Control')
await sleep(400)
const ctrlK = await page.$eval('[data-testid="link-picker-input"]', (el) => el.value).catch(() => null)
record('U13 Ctrl+K opens the picker with the selection', ctrlK === 'Some', String(ctrlK))
await page.screenshot({ path: `${ASSETS}/u13-desktop-ctrl-k.png` })
await page.keyboard.press('Escape')
await sleep(200)

// U16: hand-written app route is inert; a hostile heading stays text.
await setText(`${await value()}\n[Click](#/addons/ai/authorize?client_id=x)\n\n## <img src=x onerror=alert(1)>\n`)
await sleep(600)
await page.click('[data-testid="submenu-editor-toc"]')
await page.click('[data-testid="submenu-editor-toc-refresh"]')
await sleep(700)
const inert = await page.$eval('[data-testid="preview-content"] span.pn-link-broken', (el) => ({ text: el.textContent, title: el.title })).catch(() => null)
const hostileImg = await page.$('[data-testid="preview-content"] nav img')
record('U16 #/ link inert with the title, hostile heading listed as text, no script', inert?.title === "Links to Panino screens aren't supported" && !hostileImg && dialogs === 0, JSON.stringify(inert))
const hashNow = await page.evaluate(() => location.hash)
await page.evaluate(() => document.querySelector('[data-testid="preview-content"] span.pn-link-broken')?.click())
await sleep(300)
record('U16 clicking it does not navigate', (await page.evaluate(() => location.hash)) === hashNow)

// U12 (request side): the PDF export marks the resolved Document link for the API.
await page.evaluate(() => { location.hash = '#/print-styles' })
await sleep(4000)
const pdfBody = await page.evaluate(() => window.__pdfBodies.at(-1) || '')
record('U12 PDF request marks the resolved Document link and keeps heading anchors', pdfBody.includes(`data-pn-doc=\\"${ids.b}\\"`) && pdfBody.includes('href=\\"#pn-budget\\"') && !pdfBody.includes('panino:'), `${pdfBody.length} bytes`)
await page.screenshot({ path: `${ASSETS}/u12-desktop-print-styles.png` })

// U17 (signed in): a deep link without dbKey gains it; an unknown id shows the empty state.
await page.goto('about:blank')
await page.goto(`${APP}/#/doc/${ids.b}`, { waitUntil: 'networkidle2' })
await sleep(3000)
record('U17 deep link without dbKey is looked up and dbKey added', (await page.evaluate(() => location.hash)).includes('dbKey='), await page.evaluate(() => location.hash))
await page.goto('about:blank')
await page.goto(`${APP}/#/doc/12345678-1234-4234-8234-123456789abc`, { waitUntil: 'networkidle2' })
await page.waitForSelector('[data-testid="doc-not-available"]', { timeout: 20000 }).catch(() => null)
const unavailable = await page.$eval('[data-testid="doc-not-available"]', (el) => el.textContent).catch(() => null)
record('U17 unknown id shows "isn\'t available" with Go to Home', Boolean(unavailable?.includes("This Document isn't available")) && Boolean(unavailable?.includes('Go to Home')), String(unavailable))
await page.screenshot({ path: `${ASSETS}/u17-desktop-not-available.png` })

// Phone 375: menu rows, options sheet, Preview heading scroll inside the Preview only.
await page.goto('about:blank')
await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true })
await page.goto(`${APP}/#/doc/${ids.a}?dbKey=${ids.dbKey}`, { waitUntil: 'networkidle2' })
await page.waitForSelector('[data-testid="phone-editor"]', { timeout: 20000 })
await sleep(1000)
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Not now')?.click())
await page.click('[data-testid="phone-editor-menu"]')
await page.waitForSelector('[data-testid="phone-menu-toc"]')
const phoneRow = await page.$eval('[data-testid="phone-menu-toc"]', (el) => el.textContent.replace(/\s+/g, ' ').trim())
record('U6 phone menu offers Refresh table of contents', phoneRow.startsWith('Refresh table of contents'), phoneRow)
await page.screenshot({ path: `${ASSETS}/u6-phone-document-menu.png` })
await page.evaluate(() => document.querySelector('[data-testid="phone-menu-toc-options"]').click())
await page.waitForSelector('[data-testid="phone-toc-sheet"] [data-testid="toc-options-form"]', { timeout: 5000 }).catch(() => null)
record('Phone Contents options opens ?sheet=toc', (await page.evaluate(() => location.hash)).includes('sheet=toc'))
await page.screenshot({ path: `${ASSETS}/phone-toc-options-sheet.png` })
await page.goBack()
await sleep(800)
const phoneScroll = await page.evaluate(() => {
    const preview = document.querySelector('.ph-preview')
    const shell = document.querySelector('.phone-ui')
    const before = { preview: preview?.scrollTop, shell: shell?.scrollTop, win: window.scrollY }
    document.querySelector('[data-testid="preview-content"] nav a[href="#pn-budget"]')?.click()
    return new Promise((resolve) => setTimeout(() => resolve({ before, after: { preview: preview?.scrollTop, shell: shell?.scrollTop, win: window.scrollY }, active: document.activeElement?.id }), 300))
})
record('Phone heading link focuses the heading and scrolls only the Preview', phoneScroll.active === 'pn-budget' && phoneScroll.after.win === phoneScroll.before.win, JSON.stringify(phoneScroll))
await page.screenshot({ path: `${ASSETS}/phone-preview-toc.png` })

const relevant = consoleErrors.filter((line) => !/GET .*\/spaces|404|Failed to load resource/.test(line))
record('No unexpected console errors', relevant.length === 0, relevant.slice(0, 5).join(' | '))
fs.writeFileSync(`${ASSETS}/results.json`, JSON.stringify({ results, consoleErrors }, null, 2))
await browser.close()

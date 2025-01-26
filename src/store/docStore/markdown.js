import MarkdownIt from 'markdown-it'
import markdownItTaskLists from 'markdown-it-task-lists'

/**
 * Creates and configures a MarkdownIt instance.
 * All styling rules are injected here.
 *
 * @param {object} styles - The Tailwind classes keyed by tag or element.
 */
export function createMarkdownIt(styles) {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: true
  }).use(markdownItTaskLists)

  md.renderer.rules.paragraph_open = () => `<span class="${styles.p}">`
  md.renderer.rules.paragraph_close = () => '</span>'

  md.renderer.rules.heading_open = (tokens, idx) => {
    const tag = tokens[idx].tag
    return `<${tag} class="${styles[tag]}">`
  }
  md.renderer.rules.bullet_list_open = () => `<ul class="${styles.ul}">`
  md.renderer.rules.ordered_list_open = () => `<ol class="${styles.ol}">`

  md.renderer.rules.list_item_open = (tokens, idx) => {
    // Handle checkboxes in task lists
    if (tokens[idx].map && tokens[idx].map.length > 0) {
      if (tokens[idx + 2]?.type === 'task_list_item_open') {
        const checked = tokens[idx + 2].checked
        return `<li class="${styles.li}"><input type="checkbox" ${checked ? 'checked' : ''} disabled> `
      }
    }
    return `<li class="${styles.li}">`
  }

  md.renderer.rules.code_inline = (tokens, idx) =>
    `<code class="${styles.code}">${tokens[idx].content}</code>`

  md.renderer.rules.blockquote_open = () =>
    `<blockquote class="${styles.blockquote}">`

  md.renderer.rules.hr = () => `<hr class="${styles.hr}">`
  md.renderer.rules.em_open = () => `<em class="${styles.em}">`
  md.renderer.rules.strong_open = () => `<strong class="${styles.strong}">`

  md.renderer.rules.link_open = (tokens, idx) => {
    const href = tokens[idx].attrGet('href')
    return `<a href="${href}" class="${styles.a}" target="_blank" rel="noopener">`
  }

  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx]
    const src = token.attrGet('src')
    const alt = token.content
    const title = token.attrGet('title') || ''
    return `<img src="${src}" alt="${alt}" title="${title}" class="${styles.img}">`
  }

  md.renderer.rules.table_open = () => `<table class="${styles.table}">`
  md.renderer.rules.th_open = () => `<th class="${styles.th}">`
  md.renderer.rules.td_open = () => `<td class="${styles.td}">`

  return md
}

import OverType from 'overtype';

let patchesApplied = false;

export function useOverTypePatches() {
  if (patchesApplied) return;

  /* ───── OverType Monkey Patches ───── */
  
  // 1. Patch postProcessHTML to skip <pre> block creation but keep list consolidation
  if (OverType.MarkdownParser) {
    OverType.MarkdownParser.postProcessHTML = function(html) {
      if (typeof document === 'undefined' || !document) return html;
      
      const container = document.createElement('div');
      container.innerHTML = html;
      
      let currentList = null;
      let listType = null;
      
      const children = Array.from(container.children);
      
      for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (!child.parentNode) continue;
          
          // Note: We deliberately SKIP code block merging logic here to avoid <pre> tags
          // which cause alignment issues. We only handle list consolidation.
          
          let listItem = null;
          if (child.tagName === 'DIV') {
              listItem = child.querySelector('li');
          }
          
          if (listItem) {
              const isBullet = listItem.classList.contains('bullet-list');
              const isOrdered = listItem.classList.contains('ordered-list');
              
              if (!isBullet && !isOrdered) {
                  currentList = null;
                  listType = null;
                  continue;
              }
              
              const newType = isBullet ? 'ul' : 'ol';
              
              if (!currentList || listType !== newType) {
                  currentList = document.createElement(newType);
                  container.insertBefore(currentList, child);
                  listType = newType;
              }
              
              const indentationNodes = [];
              for (const node of child.childNodes) {
                  if (node.nodeType === 3 && node.textContent.match(/^\u00A0+$/)) {
                      indentationNodes.push(node.cloneNode(true));
                  } else if (node === listItem) {
                      break;
                  }
              }
              
              indentationNodes.forEach(node => {
                  listItem.insertBefore(node, listItem.firstChild);
              });
              
              currentList.appendChild(listItem);
              child.remove();
          } else {
              currentList = null;
              listType = null;
          }
      }
      
      return container.innerHTML;
    };
  }

  // 2. Patch _applyCodeBlockBackgrounds to style individual lines between fences
  OverType.prototype._applyCodeBlockBackgrounds = function() {
     const codeFences = this.preview.querySelectorAll('.code-fence');
     
     // Process pairs of code fences
     for (let i = 0; i < codeFences.length - 1; i += 2) {
       const openFence = codeFences[i];
       const closeFence = codeFences[i + 1];
       
       const openParent = openFence.parentElement;
       const closeParent = closeFence.parentElement;
       
       if (!openParent || !closeParent) continue;
       
       // Style the fences
       openParent.classList.add('code-block-line');
       closeParent.classList.add('code-block-line');
       
       // Style everything in between (which are now just simple divs)
       let sibling = openParent.nextElementSibling;
       while (sibling && sibling !== closeParent) {
         sibling.classList.add('code-block-line');
         sibling = sibling.nextElementSibling;
       }
     }
  };

  // 3. Ctrl/Cmd+K belongs to Panino's link picker
  //    (docs/specs/active/editor-toc-and-internal-links.md §6.5). OverType's shortcut
  //    manager would insert `[sel](url)` itself and then never call the `onKeydown`
  //    option. Report the key unhandled so Panino's handler opens the picker; bold,
  //    italic and the list shortcuts are unchanged.
  const Shortcuts = OverType.ShortcutsManager;
  if (Shortcuts?.prototype?.handleKeydown && !Shortcuts.prototype.handleKeydown.__paninoLinks) {
    const original = Shortcuts.prototype.handleKeydown;
    const patched = function handleKeydown(event) {
      if (event && (event.ctrlKey || event.metaKey) && !event.shiftKey && String(event.key || '').toLowerCase() === 'k') {
        return false;
      }
      return original.call(this, event);
    };
    patched.__paninoLinks = true;
    Shortcuts.prototype.handleKeydown = patched;
  }

  patchesApplied = true;
}

/**
 * OverType's link tooltip opens `window.open(url, '_blank')` for any link under the
 * caret, which for `panino:` or `#…` is an unknown scheme or a broken route in a new
 * tab. Its click handler is bound when the tooltip is built, so the tooltip element is
 * swapped for a copy with Panino's handlers: internal links are followed in the app,
 * web and mail addresses still open in a new tab (without an opener).
 *
 * @param {object} editor an OverType instance
 * @param {(url: string) => void} follow Panino's handler for a link's address
 * @returns {boolean} whether the tooltip was patched
 */
export function patchLinkTooltip(editor, follow) {
  const tooltip = editor?.linkTooltip;
  const element = tooltip?.tooltip;
  if (!tooltip || !element || element.__paninoLinks) return false;
  const copy = element.cloneNode(true);
  copy.__paninoLinks = true;
  copy.addEventListener('mouseenter', () => tooltip.cancelHide?.());
  copy.addEventListener('mouseleave', () => tooltip.scheduleHide?.());
  copy.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const url = tooltip.currentLink?.url;
    if (!url) return;
    tooltip.hide?.();
    if (/^(https?:|mailto:)/i.test(url.trim())) {
      window.open(url.trim(), '_blank', 'noopener,noreferrer');
      return;
    }
    follow(url);
  });
  element.replaceWith(copy);
  tooltip.tooltip = copy;
  return true;
}

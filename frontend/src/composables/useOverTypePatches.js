import OverType from 'overtype';

let patchesApplied = false;

export function useOverTypePatches() {
  if (patchesApplied) return;

  /* ───── OverType Monkey Patches ───── */
  
  // 1. Patch postProcessHTML to skip <pre> block creation but keep list consolidation
  if (OverType.MarkdownParser) {
    OverType.MarkdownParser.postProcessHTML = function(html, instanceHighlighter) {
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

  patchesApplied = true;
}

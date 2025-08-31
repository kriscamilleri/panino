
<script setup>
import { watchEffect } from 'vue';
import { useMarkdownStore } from '@/store/markdownStore';

const markdownStore = useMarkdownStore();
const styleId = 'panino-markdown-styles';

watchEffect(() => {
  let styleEl = document.getElementById(styleId);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  // This watcher automatically updates the stylesheet
  // whenever the computed CSS string changes in the store.
  styleEl.textContent = markdownStore.livePreviewCss;
});
</script>
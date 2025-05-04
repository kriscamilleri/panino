<!-- frontend/src/components/HeaderFooterPreview.vue -->
<template>
  <span v-if="!content" class="text-gray-300">(empty)</span>

  <template v-else>
    <span v-if="type === 'text'">{{ content }}</span>

    <!-- Image preview (header / footer only) -->
    <img v-else :src="content" class="header-footer-img" />
  </template>
</template>

<script setup>
/**
 * Display helper for page-header / page-footer margin-box content.
 * Props:
 *   • type:    'text' | 'image'
 *   • content: string   (plain text or image URL)
 */
const props = defineProps({
  type: { type: String, default: 'text' },
  content: { type: String, default: '' }
})
</script>

<style scoped>
/* ---------- Screen preview ---------- */
.header-footer-img {
  /* keeps previews tidy in the in-app pane */
  max-height: 2rem;
  /* ≈ 32 px */
  max-width: 6rem;
  /* ≈ 96 px */
  object-fit: contain;
}

/* ---------- When the user actually prints ---------- */
@media print {
  .header-footer-img {
    /* these numbers are safely inside Chrome’s default 1 cm page margins */
    max-height: 1cm;
    max-width: 4cm;
    object-fit: contain;
  }
}
</style>

<template>
  <span v-if="!content" class="text-gray-300">(empty)</span>

  <template v-else>
    <span v-if="type === 'text'" class="header-footer-text">{{ content }}</span>

    <!-- Image preview (now supports base64) -->
    <div v-else class="header-footer-img-container">
      <img :src="content" class="header-footer-img" alt="Header/Footer Image" />
    </div>
  </template>
</template>

<script setup>
/**
 * Display helper for page-header / page-footer margin-box content.
 * Updated to handle base64-encoded images properly.
 * 
 * Props:
 *   • type:    'text' | 'image'
 *   • content: string   (plain text or base64-encoded image)
 */
const props = defineProps({
  type: { type: String, default: 'text' },
  content: { type: String, default: '' }
})
</script>
<style scoped>
/* ---------- Screen preview ---------- */
.header-footer-img-container {
  display: inline-block;
  position: relative;
  max-width: 5rem;
  /* ~80px - reduced from 6rem */
  max-height: 1.5rem;
  /* ~24px - reduced from 2rem */
  overflow: hidden;
}

.header-footer-img {
  max-height: 1.5rem;
  /* ~24px - reduced from 2rem */
  max-width: 5rem;
  /* ~80px - reduced from 6rem */
  object-fit: contain;
  display: block;
}

.header-footer-text {
  /* Prevent super long text from breaking layout */
  display: inline-block;
  max-width: 5rem;
  /* ~80px - reduced from 6rem */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- When the user actually prints ---------- */
@media print {
  .header-footer-img {
    /* Reduced from 1cm/4cm to 0.8cm/3.2cm */
    max-height: 0.8cm;
    max-width: 3.2cm;
    object-fit: contain;
  }

  .header-footer-text {
    max-width: 3.2cm;
    /* Reduced from 4cm */
  }
}
</style>
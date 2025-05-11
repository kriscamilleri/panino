<template>
    <span v-if="!content" class="text-gray-300">(empty)</span>

    <template v-else>
        <span v-if="type === 'text'" class="header-footer-text">{{ content }}</span>

        <!-- Image preview (header / footer only) -->
        <div v-else class="header-footer-img-container">
            <img v-if="isBase64(content)" :src="content" class="header-footer-img" alt="Header/Footer Image" />
            <img v-else :src="content" class="header-footer-img" alt="Header/Footer Image" />
        </div>
    </template>
</template>

<script setup>
/**
 * Enhanced display helper for page-header / page-footer margin-box content.
 * Now handles both text and base64-encoded images with better error handling.
 * 
 * Props:
 *   • type:    'text' | 'image'
 *   • content: string   (plain text or image URL/base64)
 */
import { computed } from 'vue';

const props = defineProps({
    type: { type: String, default: 'text' },
    content: { type: String, default: '' }
});

/**
 * Helper function to detect if a string is a base64 image
 */
function isBase64(str) {
    if (typeof str !== 'string') return false;
    return str.startsWith('data:image/');
}
</script>

<style scoped>
/* ---------- Screen preview ---------- */
.header-footer-img-container {
    display: inline-block;
    position: relative;
    max-width: 6rem;
    /* ~96px */
    max-height: 2rem;
    /* ~32px */
    overflow: hidden;
}

.header-footer-img {
    max-height: 2rem;
    /* ~32px */
    max-width: 6rem;
    /* ~96px */
    object-fit: contain;
    display: block;
}

.header-footer-text {
    /* Prevent super long text from breaking layout */
    display: inline-block;
    max-width: 6rem;
    /* ~96px */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ---------- When the user actually prints ---------- */
@media print {
    .header-footer-img {
        /* these numbers are safely inside Chrome's default 1 cm page margins */
        max-height: 1cm;
        max-width: 4cm;
        object-fit: contain;
    }

    .header-footer-text {
        max-width: 4cm;
    }
}
</style>
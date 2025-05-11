<template>
    <div class="image-paste-handler">
        <!-- Mode Toggle Button -->
        <div class="flex items-center mb-2">
            <label class="flex items-center cursor-pointer">
                <input type="checkbox" :checked="isImageMode" @change="toggleMode" class="sr-only peer" />
                <div class="relative w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-2 peer-focus:ring-gray-300 
                      peer-checked:after:translate-x-full peer-checked:after:border-white 
                      after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 
                      after:border after:rounded-full after:h-5 after:w-5 after:transition-all 
                      peer-checked:bg-blue-600"></div>
                <span class="ml-2 text-sm font-medium text-gray-700">{{ isImageMode ? 'Image' : 'Text' }}</span>
            </label>
        </div>

        <!-- Text Input -->
        <div v-if="!isImageMode" class="mb-2">
            <input v-model="textContent" type="text" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                 focus:outline-none focus:ring-gray-500 focus:border-gray-500
                 sm:text-sm" :placeholder="placeholder || 'Text content...'" />
        </div>

        <!-- Image Input -->
        <div v-else>
            <!-- Image Preview -->
            <div v-if="imageContent" class="mb-2 relative border p-2 rounded bg-gray-50 group">
                <img :src="imageContent" class="max-h-16 max-w-full object-contain" alt="Pasted image" />
                <button @click="clearImage" class="absolute top-1 right-1 p-1 bg-white rounded-full shadow 
                   opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Paste Zone -->
            <div class="relative border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer"
                :class="[
                    imageContent
                        ? 'border-gray-300 bg-gray-50'
                        : 'border-gray-300 hover:border-gray-400 bg-gray-50 hover:bg-gray-100',
                    { 'border-blue-500': isPasteActive }
                ]" @paste="handlePaste" @dragover.prevent="isPasteActive = true"
                @dragleave.prevent="isPasteActive = false" @drop.prevent="handleDrop" @click="openFileSelector"
                tabindex="0" ref="pasteZone">
                <input type="file" ref="fileInput" class="hidden" accept="image/*" @change="handleFileSelect" />

                <div class="flex flex-col items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-400 mb-2" fill="none"
                        viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p class="text-sm text-gray-600 font-medium">
                        Paste image, drag & drop, or click to select
                    </p>
                </div>
            </div>

            <!-- Error message if any -->
            <div v-if="error" class="mt-2 text-sm text-red-600">
                {{ error }}
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';

const props = defineProps({
    modelValue: {
        type: Object,
        required: true,
        validator: (val) => {
            return (
                val &&
                typeof val === 'object' &&
                'type' in val &&
                'content' in val
            );
        }
    },
    placeholder: {
        type: String,
        default: ''
    },
    maxWidth: {
        type: Number,
        default: 150
    },
    maxHeight: {
        type: Number,
        default: 40
    }
});

const emit = defineEmits(['update:modelValue']);

// Local state
const isImageMode = computed(() => props.modelValue.type === 'image');
const textContent = ref(props.modelValue.content || '');
const imageContent = ref(props.modelValue.content || '');
const error = ref('');
const isPasteActive = ref(false);
const fileInput = ref(null);
const pasteZone = ref(null);

// Update the content when modelValue changes externally
watch(() => props.modelValue, (newVal) => {
    if (newVal.type === 'text') {
        textContent.value = newVal.content || '';
    } else {
        imageContent.value = newVal.content || '';
    }
}, { deep: true });

// Update modelValue when textContent changes
watch(textContent, (newVal) => {
    if (!isImageMode.value) {
        emit('update:modelValue', {
            type: 'text',
            content: newVal
        });
    }
});

// Toggle between text and image mode
function toggleMode() {
    const newType = isImageMode.value ? 'text' : 'image';
    emit('update:modelValue', {
        type: newType,
        content: newType === 'text' ? textContent.value : imageContent.value
    });
}

// Clear the image
function clearImage() {
    imageContent.value = '';
    emit('update:modelValue', {
        type: 'image',
        content: ''
    });
}

// Open file selector
function openFileSelector() {
    if (isImageMode.value) {
        fileInput.value.click();
    }
}
/**
 * Enhanced paste handler with better SVG support
 * Add this to your ImagePasteHandler component
 */
async function handlePaste(event) {
    if (!isImageMode.value) return;

    error.value = '';
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Check for SVG text content in paste
        if (item.type === 'text/plain') {
            try {
                const text = await new Promise(resolve => {
                    item.getAsString(resolve);
                });

                // Check if it looks like SVG content (basic detection)
                if (text.trim().startsWith('<svg') && text.includes('</svg>')) {
                    console.log('Detected SVG in clipboard text');

                    // Handle it as SVG by converting to a blob
                    const blob = new Blob([text], { type: 'image/svg+xml' });
                    await processImage(blob);
                    return;
                }
            } catch (err) {
                console.warn('Error checking for SVG text:', err);
            }
        }

        // Handle image types normally
        if (item.type.indexOf('image/') === 0) {
            const file = item.getAsFile();
            if (file) {
                await processImage(file);
                return;
            }
        }
    }
}

/**
 * Handle file drop with improved SVG detection
 */
async function handleDrop(event) {
    if (!isImageMode.value) return;

    isPasteActive.value = false;
    error.value = '';

    const items = event.dataTransfer.items;
    if (items) {
        // Look through items first (for better type handling)
        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // Check for SVG text content in drag-and-drop text
            if (item.type === 'text/plain') {
                try {
                    const text = await new Promise(resolve => {
                        item.getAsString(resolve);
                    });

                    // Check if it looks like SVG content
                    if (text.trim().startsWith('<svg') && text.includes('</svg>')) {
                        console.log('Detected SVG in drag-and-drop text');

                        // Handle it as SVG
                        const blob = new Blob([text], { type: 'image/svg+xml' });
                        await processImage(blob);
                        return;
                    }
                } catch (err) {
                    console.warn('Error checking for SVG text:', err);
                }
            }

            // Handle image type items
            if (item.type.indexOf('image/') === 0) {
                const file = item.getAsFile();
                if (file) {
                    await processImage(file);
                    return;
                }
            }
        }
    }

    // Fallback to files
    const files = event.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];

        // Check if it's an SVG or image file
        if (file.type === 'image/svg+xml' || file.type.startsWith('image/')) {
            await processImage(file);
        } else {
            error.value = 'Please drop an image file';
        }
    }
}
// Handle file selection
async function handleFileSelect(event) {
    if (!isImageMode.value) return;

    error.value = '';
    const file = event.target.files[0];

    if (file && file.type.startsWith('image/')) {
        await processImage(file);
    } else {
        error.value = 'Please select an image file';
    }

    // Reset file input for reuse
    if (fileInput.value) {
        fileInput.value.value = '';
    }
}

// Process image file
async function processImage(file) {
    try {
        const base64 = await loadAndResizeImageToBase64(file, props.maxWidth, props.maxHeight);
        if (base64) {
            imageContent.value = base64;
            emit('update:modelValue', {
                type: 'image',
                content: base64
            });
        } else {
            error.value = 'Failed to process image';
        }
    } catch (err) {
        console.error('Image processing error:', err);
        error.value = 'Error processing image: ' + (err.message || 'Unknown error');
    }
}// In ImagePasteHandler.vue, replace the existing loadAndResizeImageToBase64 function with this:

/**
 * Simple, direct approach to load and resize images with better quality
 * This approach is more reliable across browsers
 */async function loadAndResizeImageToBase64(file, maxWidth, maxHeight) {
    if (!file || !file.type.startsWith('image/')) {
        throw new Error('Invalid file type');
    }

    // For SVGs, we need special handling to ensure they scale properly
    const isSvg = file.type === 'image/svg+xml';

    // High-res multiplier (only for raster images, not for SVGs)
    const highResMultiplier = isSvg ? 1 : 4;

    // Target dimensions
    const targetWidth = (maxWidth || 120) * highResMultiplier;
    const targetHeight = (maxHeight || 32) * highResMultiplier;

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = async (event) => {
            try {
                // For SVGs, we can optimize the SVG directly
                if (isSvg) {
                    const svgText = event.target.result;
                    const optimizedSvg = await optimizeSvg(svgText, targetWidth, targetHeight);
                    resolve('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(optimizedSvg))));
                    return;
                }

                // For raster images, use our standard high-res approach
                const img = new Image();

                img.onload = () => {
                    try {
                        // Calculate dimensions with proper aspect ratio
                        let { width, height } = img;
                        const ratio = Math.min(targetWidth / width, targetHeight / height, 1);
                        const w = Math.round(width * ratio);
                        const h = Math.round(height * ratio);

                        // Create high-resolution canvas
                        const canvas = document.createElement('canvas');
                        canvas.width = w;
                        canvas.height = h;

                        // Get drawing context
                        const ctx = canvas.getContext('2d');

                        // Set high quality image smoothing
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';

                        // Draw image to canvas at high resolution
                        ctx.drawImage(img, 0, 0, w, h);

                        // Check if image has transparency
                        let hasTransparency = false;
                        try {
                            const pixelData = ctx.getImageData(0, 0, w, h).data;
                            const step = Math.max(1, Math.floor(pixelData.length / 4000));
                            for (let i = 3; i < pixelData.length; i += 4 * step) {
                                if (pixelData[i] < 255) {
                                    hasTransparency = true;
                                    break;
                                }
                            }
                        } catch (e) {
                            console.warn("Couldn't analyze transparency:", e);
                        }

                        // Choose format based on content
                        let mimeType, quality;
                        if (hasTransparency) {
                            mimeType = 'image/png';
                            quality = undefined; // PNG is lossless
                        } else {
                            mimeType = 'image/jpeg';
                            quality = 0.95; // Very high quality
                        }

                        // Get base64 data
                        const dataUrl = canvas.toDataURL(mimeType, quality);

                        // Log info for debugging
                        console.log(`Created ${w}x${h} image (${hasTransparency ? 'PNG' : 'JPEG'})`);

                        resolve(dataUrl);
                    } catch (err) {
                        console.error('Image processing error:', err);
                        reject(err);
                    }
                };

                img.onerror = () => {
                    reject(new Error('Failed to load image'));
                };

                img.src = event.target.result;
            } catch (err) {
                console.error('Image processing error:', err);
                reject(err);
            }
        };

        reader.onerror = () => {
            reject(new Error('Failed to read file'));
        };

        // For SVGs, read as text; for other images, read as data URL
        if (isSvg) {
            reader.readAsText(file);
        } else {
            reader.readAsDataURL(file);
        }
    });
}

/**
 * Optimize an SVG to ensure it renders at the optimal size
 * - Sets viewBox if not present
 * - Adds width/height attributes that match our target dimensions
 * - Preserves aspect ratio
 */
async function optimizeSvg(svgText, targetWidth, targetHeight) {
    // Create a DOM parser to work with the SVG
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;

    // Get existing viewBox or calculate one from dimensions
    let viewBox = svg.getAttribute('viewBox');
    let width = svg.getAttribute('width');
    let height = svg.getAttribute('height');

    // If no dimensions are specified, set a default viewBox
    if (!viewBox && (!width || !height)) {
        viewBox = '0 0 100 100';
    }

    // Parse existing dimensions, defaulting to viewBox if available
    let numericalWidth = parseFloat(width) || 0;
    let numericalHeight = parseFloat(height) || 0;

    // If viewBox exists but no dimensions, use viewBox
    if (viewBox && (!numericalWidth || !numericalHeight)) {
        const viewBoxValues = viewBox.split(/\s+/).map(parseFloat);
        if (viewBoxValues.length === 4) {
            if (!numericalWidth) numericalWidth = viewBoxValues[2];
            if (!numericalHeight) numericalHeight = viewBoxValues[3];
        }
    }

    // Ensure we have some dimensions
    if (!numericalWidth) numericalWidth = 100;
    if (!numericalHeight) numericalHeight = 100;

    // Calculate the appropriate dimensions to fit within our constraints
    const aspectRatio = numericalWidth / numericalHeight;
    let finalWidth, finalHeight;

    if (aspectRatio > targetWidth / targetHeight) {
        // Width is the limiting factor
        finalWidth = targetWidth;
        finalHeight = targetWidth / aspectRatio;
    } else {
        // Height is the limiting factor
        finalHeight = targetHeight;
        finalWidth = targetHeight * aspectRatio;
    }

    // Make sure we have a viewBox that maintains the aspect ratio
    if (!viewBox) {
        viewBox = `0 0 ${numericalWidth} ${numericalHeight}`;
    }

    // Set the attributes to ensure proper rendering
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('width', finalWidth);
    svg.setAttribute('height', finalHeight);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Serialize back to text
    const serializer = new XMLSerializer();
    let optimizedSvg = serializer.serializeToString(doc);

    // SVG validation and cleaning
    // Remove XML declaration as it can cause issues in some browsers
    optimizedSvg = optimizedSvg.replace(/<\?xml[^>]*\?>/, '');

    // Log info for debugging
    console.log(`Optimized SVG to ${Math.round(finalWidth)}×${Math.round(finalHeight)}`);

    return optimizedSvg;
}
// Set focus to paste zone on mount
onMounted(() => {
    nextTick(() => {
        if (pasteZone.value) {
            pasteZone.value.focus();
        }
    });
});
</script>

<style scoped>
.image-paste-handler {
    width: 100%;
}
</style>
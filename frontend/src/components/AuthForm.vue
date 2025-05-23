<template>
    <div class="min-h-screen bg-gray-100 flex flex-col">
        <div class="flex flex-grow"></div>
        <!-- PaNiNo Header -->
        <div class="flex justify-center my-4 flex-col items-center">
            <h1 class="flex text-4xl text-center font-extrabold text-gray-900 mb-2">panino</h1>
            <p class="flex text-center text-gray-600 mb-8">a
                <a target="_blank" class="text-blue-500 underline" href="https://prettyneat.io">pretty neat</a>
                note taking app
            </p>
        </div>
        <!-- Main Content -->
        <div class="flex items-center justify-center px-4 sm:px-6 lg:px-8">
            <div class="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
                <form class="space-y-6" @submit.prevent="handleSubmit">
                    <div class="flex items-center justify-between mb-3">
                        <h3 class="text-lg font-bold text-gray-800">{{ config.title }}</h3>
                    </div>

                    <!-- Dynamic Fields -->
                    <div v-for="field in config.fields" :key="field.name">
                        <label :for="field.name" class="block text-sm font-medium text-gray-700">
                            {{ field.label }}
                        </label>
                        <div class="mt-1">
                            <input :id="field.name" v-model="formData[field.name]" :name="field.name" :type="field.type"
                                :required="field.required"
                                class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                :disabled="loading" :class="{ 'border-red-300': formErrors[field.name] }"
                                :data-testid="`${config.type}-${field.name}-input`" />
                            <p v-if="formErrors[field.name]" class="mt-1 text-sm text-red-600"
                                :data-testid="`${config.type}-${field.name}-error`">
                                {{ formErrors[field.name] }}
                            </p>
                        </div>
                    </div>

                    <!-- Password Requirements (Signup) -->
                    <div v-if="config.showPasswordRequirements" class="rounded-md bg-gray-50 p-4">
                        <div class="text-sm text-gray-700">
                            <h4 class="font-medium mb-2">Password Requirements:</h4>
                            <ul class="space-y-1">
                                <li class="flex items-center gap-2">
                                    <span class="text-lg"
                                        :class="passwordLengthValid ? 'text-green-700' : 'text-gray-300'">●</span>
                                    At least 6 characters
                                </li>
                            </ul>
                        </div>
                    </div>

                    <!-- Turnstile (Signup) -->
                    <div v-if="config.showTurnstile && turnstileSiteKey" class="mb-2">
                        <div id="turnstile-container" ref="turnstileContainer" class="flex justify-center"
                            :data-testid="`${config.type}-turnstile-container`">
                        </div>
                    </div>

                    <!-- Form Error Message -->
                    <div v-if="error" class="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm"
                        :data-testid="`${config.type}-error-message`">
                        {{ error }}
                    </div>

                    <!-- Submit Button -->
                    <div>
                        <button type="submit"
                            class="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            :disabled="loading || !isFormValid" :data-testid="`${config.type}-submit-button`">
                            <template v-if="loading">
                                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                                    xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                        stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                    </path>
                                </svg>
                                {{ config.loadingText || 'Processing...' }}
                            </template>
                            <template v-else>{{ config.submitText }}</template>
                        </button>
                    </div>
                </form>

                <!-- Guest Button (Login) -->
                <div v-if="config.showGuestButton" class="mt-3">
                    <button type="button"
                        class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-gray-700 bg-gray-200 hover:bg-gray-300"
                        @click="handleGuest" :data-testid="`${config.type}-guest-button`" :disabled="loading">
                        Continue as guest
                    </button>
                </div>

                <!-- Alternate Auth Link -->
                <div class="text-sm text-center mt-3">
                    <router-link :to="config.link.to" class="font-medium text-gray-600 hover:text-gray-900"
                        :data-testid="`${config.type}-alternate-link`">
                        {{ config.link.text }}
                    </router-link>
                </div>
                <div class="my-8 border-b border-gray-200"></div>
                <!-- Terms & GitHub Links -->
                <div class="text-sm text-center mt-3">
                    <router-link to="/terms" class="font-medium text-gray-600 hover:text-gray-900"
                        :data-testid="`${config.type}-terms-link`">
                        Terms of Service
                    </router-link>
                </div>
                <div class="text-sm text-center mt-3">
                    <a href="https://github.com/kriscamilleri/pn-markdown-notes" target="_blank"
                        class="text-sm font-medium text-gray-600 hover:text-gray-900"
                        :data-testid="`${config.type}-github-link`">
                        Github
                    </a>
                </div>
            </div>
        </div>
        <div class="flex flex-grow"></div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useAuthStore } from '@/store/authStore';
import { useRouter } from 'vue-router';

const props = defineProps({
    config: { type: Object, required: true }
});

const authStore = useAuthStore();
const router = useRouter();

const formData = ref({});
const loading = ref(false);
const error = ref('');
const formErrors = ref({});

// Initialize formData based on config fields
props.config.fields.forEach(field => {
    formData.value[field.name] = '';
});

const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const turnstileContainer = ref(null);
let turnstileWidgetId = null;

// Validation logic
watch(formData, () => {
    formErrors.value = {};
    props.config.fields.forEach(field => {
        if (field.required && !formData.value[field.name]) {
            formErrors.value[field.name] = `${field.label} is required.`;
        }
        if (field.minLength && formData.value[field.name] && formData.value[field.name].length < field.minLength) {
            formErrors.value[field.name] = `${field.label} must be at least ${field.minLength} characters.`;
        }
        if (field.matches && formData.value[field.name] !== formData.value[field.matches]) {
            formErrors.value[field.name] = 'Passwords do not match.';
        }
    });
}, { deep: true });

const passwordLengthValid = computed(() => {
    const passwordField = props.config.fields.find(f => f.name === 'password');
    return passwordField && formData.value.password && formData.value.password.length >= (passwordField.minLength || 6);
});

const isFormValid = computed(() => {
    if (Object.keys(formErrors.value).length > 0) return false;
    return props.config.fields.every(field => {
        if (field.required && !formData.value[field.name]) return false;
        // Add other field-specific validations from config if needed
        return true;
    });
});

// Turnstile methods (condensed, assuming they are mostly the same as SignupForm)

// Load the Turnstile script
async function loadTurnstileScript() {
    // Only load if not already present
    if (window.turnstile) return window.turnstile

    return new Promise((resolve, reject) => { // Added reject
        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        script.defer = true
        script.onload = () => {
            console.log('Turnstile script loaded')
            if (window.turnstile) {
                resolve(window.turnstile)
            } else {
                console.error('Turnstile script loaded but window.turnstile is undefined')
                reject(new Error('Turnstile script failed to initialize'))
            }
        }
        script.onerror = (err) => { // Added onerror
            console.error('Failed to load Turnstile script:', err)
            reject(new Error('Failed to load Turnstile script'))
        }
        document.head.appendChild(script)
    })
}

// Render the turnstile widget
async function renderTurnstileWidget() {
    // Clear the container first
    if (turnstileContainer.value) {
        turnstileContainer.value.innerHTML = ''
    } else {
        console.warn('Turnstile container ref not found yet.')
        return // Cannot render if container isn't ready
    }

    try { // Wrap in try/catch for robustness
        // Make sure turnstile is loaded
        const turnstile = await loadTurnstileScript()
        if (!turnstile) {
            console.error('Turnstile library not available after loading script.')
            return;
        }

        // Wait for DOM to be ready
        await nextTick()

        // Remove any previous widget
        if (turnstileWidgetId) {
            try {
                turnstile.remove(turnstileWidgetId)
                console.log('Removed previous Turnstile widget:', turnstileWidgetId)
            } catch (e) {
                console.error('Error removing previous widget:', e)
            }
            turnstileWidgetId = null
        }

        // Render a new widget
        turnstileWidgetId = turnstile.render('#turnstile-container', {
            sitekey: turnstileSiteKey,
            theme: 'auto',
            callback: (token) => {
                console.log(`Turnstile challenge success: ${token.substring(0, 10)}...`);
            },
            'error-callback': (errorCode) => {
                console.error(`Turnstile challenge error: ${errorCode}`);
                error.value = `CAPTCHA error (${errorCode}). Please refresh or try again.`
            },
            'expired-callback': () => {
                console.warn('Turnstile challenge expired.');
                error.value = 'CAPTCHA challenge expired. Please complete it again.'
                // Optionally re-render or prompt user
                renderTurnstileWidget();
            },
            'timeout-callback': () => {
                console.error('Turnstile challenge timed out.');
                error.value = 'CAPTCHA challenge timed out. Please refresh or try again.'
                renderTurnstileWidget(); // Try rendering again
            }
        })

        console.log('Turnstile widget rendered with ID:', turnstileWidgetId)
    } catch (err) {
        console.error('Error rendering Turnstile widget:', err)
        error.value = 'Could not load CAPTCHA. Please check your connection or try again later.'
    }
}

onMounted(async () => {
    if (turnstileSiteKey) {
        await nextTick() // Ensure container exists
        if (turnstileContainer.value) {
            await renderTurnstileWidget()
        } else {
            console.error('Turnstile container ref was null on mount.')
        }
    }
})

// Function to get the Turnstile token from the response
function getTurnstileToken() {
    if (!window.turnstile || !turnstileWidgetId) {
        console.warn('Turnstile not initialized or widget ID missing.')
        return null
    }
    try {
        return window.turnstile.getResponse(turnstileWidgetId)
    } catch (e) {
        console.error('Error getting Turnstile response:', e)
        return null
    }
}

onMounted(async () => {
    if (props.config.showTurnstile && turnstileSiteKey) {
        await nextTick();
        if (turnstileContainer.value) await renderTurnstileWidget();
    }
});

async function handleSubmit() {
    if (!isFormValid.value) return;
    loading.value = true;
    error.value = '';
    let token = null;

    if (props.config.showTurnstile && turnstileSiteKey) {
        token = getTurnstileToken();
        if (!token) {
            error.value = 'Please complete the CAPTCHA verification.';
            await renderTurnstileWidget(); // Re-render
            loading.value = false;
            return;
        }
    }

    try {
        await props.config.submitAction(formData.value, token);
        router.push({ name: 'loading', params: { timestamp: Date.now() } });
    } catch (err) {
        console.error(`${props.config.type} process error:`, err);
        error.value = err.message || `Failed to ${props.config.type}. Please try again.`;
        if (props.config.showTurnstile && turnstileSiteKey) await renderTurnstileWidget(); // Reset turnstile
    } finally {
        loading.value = false;
    }
}

async function handleGuest() {
    if (!props.config.guestAction) return;
    loading.value = true;
    error.value = '';
    try {
        await props.config.guestAction();
        router.push({ name: 'loading', params: { timestamp: Date.now() } });
    } catch (err) {
        error.value = 'Failed to continue as guest.';
    } finally {
        loading.value = false;
    }
}
</script>
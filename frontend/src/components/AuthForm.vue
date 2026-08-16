<template>
    <div class="min-h-screen bg-gray-100 flex flex-col">
        <div class="flex flex-grow"></div>
        <div class="flex justify-center my-4 flex-col items-center">
            <h1 class="flex text-4xl text-center font-extrabold text-gray-900 mb-2">panino</h1>
            <p class="flex text-center text-gray-600 mb-4">a &nbsp;
                <a target="_blank" class="text-blue-500 underline" href="https://prettyneat.io">pretty
                    neat</a> &nbsp;
                document app
            </p>
        </div>
        <div class="flex items-center justify-center px-4 sm:px-6 lg:px-8 mb-4">
            <div class="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
                <form class="space-y-6" @submit.prevent="handleSubmit">
                    <div class="flex items-center justify-between mb-3">
                        <h3 class="pn-title-modal">{{ config.title }}</h3>
                    </div>

                    <div v-for="field in config.fields" :key="field.name">
                        <label :for="field.name" class="pn-label">
                            {{ field.label }}
                        </label>
                        <div class="mt-1">
                            <input :id="field.name" v-model="formData[field.name]" :name="field.name" :type="field.type"
                                :required="field.required"
                                class="pn-input"
                                :disabled="loading" :class="{ 'pn-input-error': formErrors[field.name] }"
                                :data-testid="`${config.type}-${field.name}-input`" />
                            <p v-if="formErrors[field.name]" class="pn-field-error"
                                :data-testid="`${config.type}-${field.name}-error`">
                                {{ formErrors[field.name] }}
                            </p>
                        </div>
                    </div>

                    <div v-if="config.showPasswordRequirements" class="pn-panel-muted p-4">
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

                    <div class="flex items-center justify-end text-sm" v-if="config.extraLink">
                        <router-link :to="config.extraLink.to" class="font-medium text-gray-600 hover:text-gray-900">
                            {{ config.extraLink.text }}
                        </router-link>
                    </div>


                    <div v-if="config.showTurnstile && turnstileSiteKey" class="mb-2">
                        <div id="turnstile-container" ref="turnstileContainer" class="flex justify-center"
                            :data-testid="`${config.type}-turnstile-container`">
                        </div>
                    </div>

                    <div v-if="error" class="pn-alert pn-alert-error"
                        :data-testid="`${config.type}-error-message`">
                        {{ error }}
                    </div>

                    <div v-if="successMessage"
                        class="pn-alert pn-alert-success">
                        {{ successMessage }}
                    </div>

                    <div>
                        <button type="submit"
                            class="w-full inline-flex items-center justify-center gap-2 rounded-md border border-transparent bg-gray-800 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                            :disabled="loading || !isFormValid" :data-testid="`${config.type}-submit-button`">
                            <template v-if="loading">
                                <svg class="animate-spin h-4 w-4 text-white"
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

                <div v-if="config.showGuestButton" class="mt-3">
                    <button type="button"
                        class="w-full inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                        @click="handleGuest" :data-testid="`${config.type}-guest-button`" :disabled="loading">
                        Continue as guest
                    </button>
                </div>

                <div v-if="config.link" class="text-sm text-center mt-3">
                    <router-link :to="config.link.to" class="font-medium text-gray-600 hover:text-gray-900"
                        :data-testid="`${config.type}-alternate-link`">
                        {{ config.link.text }}
                    </router-link>
                </div>
                <div v-if="!config.hideExtra" class="my-8 border-b border-gray-200"></div>
                <div v-if="!config.hideExtra" class="text-sm text-center mt-3">
                    <router-link to="/terms" class="font-medium text-gray-600 hover:text-gray-900"
                        :data-testid="`${config.type}-terms-link`">
                        Terms of Service
                    </router-link>
                </div>
                <div v-if="!config.hideExtra" class="text-sm text-center mt-3">
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
import { useRouter } from 'vue-router';

const props = defineProps({
    config: { type: Object, required: true }
});

const router = useRouter();

const formData = ref({});
const loading = ref(false);
const error = ref('');
const successMessage = ref('');
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
    const passwordField = props.config.fields.find(f => f.name === 'password' || f.name === 'newPassword');
    return passwordField && formData.value[passwordField.name] && formData.value[passwordField.name].length >= (passwordField.minLength || 6);
});

const isFormValid = computed(() => {
    if (Object.keys(formErrors.value).length > 0) return false;
    return props.config.fields.every(field => {
        if (field.required && !formData.value[field.name]) return false;
        return true;
    });
});

// Turnstile methods
async function loadTurnstileScript() {
    if (window.turnstile) return window.turnstile
    return new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        script.defer = true
        script.onload = () => {
            if (window.turnstile) resolve(window.turnstile)
            else reject(new Error('Turnstile script failed to initialize'))
        }
        script.onerror = () => reject(new Error('Failed to load Turnstile script'))
        document.head.appendChild(script)
    })
}

async function renderTurnstileWidget() {
    if (!turnstileContainer.value) return;
    turnstileContainer.value.innerHTML = '';
    try {
        const turnstile = await loadTurnstileScript();
        await nextTick();
        if (turnstileWidgetId) turnstile.remove(turnstileWidgetId);
        turnstileWidgetId = turnstile.render('#turnstile-container', {
            sitekey: turnstileSiteKey,
            theme: 'auto',
            callback: () => { },
        });
    } catch (err) {
        error.value = 'Could not load CAPTCHA. Please try again later.'
    }
}

function getTurnstileToken() {
    if (!window.turnstile || !turnstileWidgetId) return null;
    return window.turnstile.getResponse(turnstileWidgetId);
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
    successMessage.value = '';
    let token = null;

    if (props.config.showTurnstile && turnstileSiteKey) {
        token = getTurnstileToken();
        if (!token) {
            error.value = 'Please complete the CAPTCHA verification.';
            await renderTurnstileWidget();
            loading.value = false;
            return;
        }
    }

    try {
        // The submitAction is now responsible for any redirection.
        const result = await props.config.submitAction(formData.value, token);

        if (result?.message) {
            successMessage.value = result.message;
            // Clear form on success for forms that don't redirect (e.g., update password)
            if (props.config.type === 'update-password') {
                Object.keys(formData.value).forEach(key => formData.value[key] = '');
            }
        }
    } catch (err) {
        console.error(`${props.config.type} process error:`, err);
        error.value = err.message || `Failed to ${props.config.type}. Please try again.`;
        if (props.config.showTurnstile && turnstileSiteKey) await renderTurnstileWidget();
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

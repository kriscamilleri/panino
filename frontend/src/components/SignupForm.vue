<template>
    <div class="min-h-screen bg-gray-100 flex flex-col">
        <!-- Top Navigation Bar
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <h1 class="text-xl font-semibold text-gray-800">Create Account</h1>
            </div>
        </nav> -->
        <div class="flex flex-grow">
        </div>
        <!-- PaNiNo Header -->
        <div class="flex justify-center mt-4 flex-col items-center ">
            <h1 class="flex text-4xl text-center font-extrabold text-gray-900 mb-2">panino</h1>
            <p class="flex text-center text-gray-600 ">a&nbsp;
                <a target="_blank" class="text-blue-500 underline" href="https://prettyneat.io"> pretty neat</a>
                &nbsp;note taking app
            </p>
        </div>
        <!-- Main Content -->
        <div class="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8">
            <div class="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
                <!-- Form -->
                <form class="space-y-6" @submit.prevent="handleSubmit">
                    <!-- Username -->
                    <div>
                        <label for="username" class="block text-sm font-medium text-gray-700">
                            Username
                        </label>
                        <div class="mt-1">
                            <input id="username" v-model="username" name="username" type="text" required
                                class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                :disabled="loading" :class="{ 'border-red-300': formErrors.username }" />
                            <p v-if="formErrors.username" class="mt-1 text-sm text-red-600">
                                {{ formErrors.username }}
                            </p>
                        </div>
                    </div>

                    <!-- Password -->
                    <div>
                        <label for="password" class="block text-sm font-medium text-gray-700">
                            Password
                        </label>
                        <div class="mt-1">
                            <input id="password" v-model="password" name="password" type="password" required
                                class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                :disabled="loading" :class="{ 'border-red-300': formErrors.password }" />
                            <p v-if="formErrors.password" class="mt-1 text-sm text-red-600">
                                {{ formErrors.password }}
                            </p>
                        </div>
                    </div>

                    <!-- Confirm Password -->
                    <div>
                        <label for="confirmPassword" class="block text-sm font-medium text-gray-700">
                            Confirm Password
                        </label>
                        <div class="mt-1">
                            <input id="confirmPassword" v-model="confirmPassword" name="confirmPassword" type="password"
                                required
                                class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                :disabled="loading" :class="{ 'border-red-300': formErrors.confirmPassword }" />
                            <p v-if="formErrors.confirmPassword" class="mt-1 text-sm text-red-600">
                                {{ formErrors.confirmPassword }}
                            </p>
                        </div>
                    </div>

                    <!-- Password Requirements -->
                    <div class="rounded-md bg-gray-50 p-4">
                        <div class="text-sm text-gray-700">
                            <h4 class="font-medium mb-2">Password Requirements:</h4>
                            <ul class="space-y-1">
                                <li class="flex items-center gap-2">
                                    <span class="text-lg"
                                        :class="password.length >= 6 ? 'text-green-700' : 'text-gray-300'">●</span>
                                    At least 6 characters
                                </li>
                            </ul>
                        </div>
                    </div>

                    <!-- Turnstile CAPTCHA (only if a site key is present) -->
                    <div v-if="turnstileSiteKey" class="mb-2">
                        <div class="cf-turnstile" :data-sitekey="turnstileSiteKey" data-callback="onTurnstileSuccess"
                            data-action="signup" data-theme="auto"></div>
                    </div>

                    <!-- Error Message -->
                    <div v-if="error" class="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
                        {{ error }}
                    </div>

                    <!-- Submit Button -->
                    <div>
                        <button type="submit"
                            class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            :disabled="loading || !isValid">
                            <template v-if="loading">
                                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                                    xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                        stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                    </path>
                                </svg>
                                Creating account...
                            </template>
                            <template v-else>
                                Create account
                            </template>
                        </button>
                    </div>

                    <!-- Sign In Link -->
                    <div class="text-sm text-center">
                        <router-link to="/login" class="font-medium text-gray-600 hover:text-gray-900">
                            Already have an account? Sign in
                        </router-link>
                    </div>
                </form>
            </div>
        </div>

        <div class="flex flex-grow">
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useAuthStore } from '@/store/authStore'
import { useDocStore } from '@/store/docStore'
import { useRouter } from 'vue-router'

const authStore = useAuthStore()
const docStore = useDocStore()
const router = useRouter()

const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')
const formErrors = ref({})
const turnstileToken = ref('')

// Pull in the site key from env:
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''

// The Turnstile success callback is a global function name that the script calls
window.onTurnstileSuccess = function onTurnstileSuccess(token) {
    turnstileToken.value = token
}

// Basic form validation
watch([username, password, confirmPassword], () => {
    formErrors.value = {}

    if (username.value.length > 0 && username.value.length < 3) {
        formErrors.value.username = 'Username must be at least 3 characters'
    }
    if (password.value.length > 0 && password.value.length < 6) {
        formErrors.value.password = 'Password must be at least 6 characters'
    }
    if (confirmPassword.value.length > 0 && password.value !== confirmPassword.value) {
        formErrors.value.confirmPassword = 'Passwords do not match'
    }
})

const isValid = computed(() => {
    return (
        username.value.length >= 3 &&
        password.value.length >= 6 &&
        password.value === confirmPassword.value &&
        Object.keys(formErrors.value).length === 0
    )
})

onMounted(() => {
    // Dynamically inject Turnstile script if not already present
    if (turnstileSiteKey && !document.getElementById('cf-turnstile-script')) {
        const script = document.createElement('script')
        script.id = 'cf-turnstile-script'
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
        script.async = true
        document.body.appendChild(script)
    }
})

async function handleSubmit() {
    if (!isValid.value) return

    // If Turnstile is configured, require the token:
    if (turnstileSiteKey && !turnstileToken.value) {
        error.value = 'Please complete the CAPTCHA.'
        return
    }

    loading.value = true
    error.value = ''

    try {
        // Our signup method below expects a third parameter = the Turnstile token
        await authStore.signup(username.value, password.value, turnstileToken.value)
        await authStore.login(username.value, password.value)
        router.push('/loading')
    } catch (err) {
        console.error('Signup process error:', err)
        if (err.message.includes('conflict')) {
            error.value = 'Username already exists. Please choose another.'
        } else {
            error.value = err.message || 'Failed to create account. Please try again.'
        }
    } finally {
        loading.value = false
    }
}
</script>

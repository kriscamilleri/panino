<template>
    <div class="min-h-screen bg-gray-100 flex flex-col">
        <!-- Top Navigation Bar -->
        <!-- <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <h1 class="text-xl font-semibold text-gray-800">Sign In</h1>
            </div>
        </nav> -->
        <div class="flex flex-grow">
        </div>
        <!-- PaNiNo Header -->
        <div class="flex justify-center my-4 flex-col items-center ">
            <h1 class="flex text-4xl text-center font-extrabold text-gray-900 mb-2">panino</h1>
            <p class="flex text-center text-gray-600 mb-8">a&nbsp;
                <a target="_blank" class="text-blue-500 underline" href="https://prettyneat.io"> pretty neat</a>
                &nbsp;note taking app
            </p>
        </div>
        <!-- Main Content -->
        <div class=" flex items-center justify-center px-4 sm:px-6 lg:px-8">
            <div class="max-w-md w-full bg-white shadow-lg rounded-lg p-8  ">
                <!-- Form -->

                <form class="space-y-6" @submit.prevent="handleSubmit">

                    <!-- Username -->
                    <div>
                        <div class="flex items-center justify-between mb-3">
                            <h3 class="text-lg font-bold text-gray-800">Sign In</h3>
                        </div>
                        <label for="username" class="block text-sm font-medium text-gray-700">
                            Username
                        </label>
                        <div class="mt-1">
                            <input id="username" v-model="username" name="username" type="text" required
                                class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                :disabled="loading" data-testid="login-username-input" />
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
                                :disabled="loading" data-testid="login-password-input" />
                        </div>
                    </div>

                    <!-- Error Message -->
                    <div v-if="error" class="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm"
                        data-testid="login-error-message">
                        {{ error }}
                    </div>

                    <!-- Submit Button -->
                    <div>
                        <button type="submit"
                            class="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            :disabled="loading" data-testid="login-submit-button">
                            <template v-if="loading">
                                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                                    xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                        stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                    </path>
                                </svg>
                                Signing in...
                            </template>
                            <template v-else>
                                Sign in
                            </template>
                        </button>
                    </div>
                </form>

                <!-- Continue as guest -->
                <div class="mt-3">
                    <button type="button"
                        class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-gray-700 bg-gray-200 hover:bg-gray-300"
                        @click="handleGuest" data-testid="login-guest-button">
                        Continue as guest
                    </button>
                </div>

                <!-- Sign Up Link -->
                <div class="text-sm text-center mt-3">
                    <router-link to="/signup" class="font-medium text-gray-600 hover:text-gray-900"
                        data-testid="login-signup-link">
                        Don't have an account? Sign up
                    </router-link>
                </div>
                <div class="my-8 border-b border-gray-200"></div>
                <!-- Terms of Service link -->
                <div class="text-sm text-center mt-3">
                    <router-link to="/terms" class="font-medium text-gray-600 hover:text-gray-900"
                        data-testid="login-terms-link">
                        Terms of Service
                    </router-link>
                </div>
                <!-- About link -->
                <div class="text-sm text-center mt-3">
                    <a href="https://github.com/kriscamilleri/pn-markdown-notes" target="_blank"
                        class="text-sm font-medium text-gray-600 hover:text-gray-900" data-testid="login-github-link">
                        <span>Github</span>
                    </a>
                </div>

            </div>
        </div>
        <div class="flex flex-grow">
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../store/authStore'
import { useDocStore } from '../store/docStore'
import { useRouter } from 'vue-router'

const authStore = useAuthStore()
const docStore = useDocStore()
const router = useRouter()

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function handleSubmit() {
    loading.value = true
    error.value = ''

    try {
        await authStore.login(username.value, password.value)
        router.push({ name: 'loading', params: { timestamp: Date.now() } }) // Add timestamp to force reload
    } catch (err) {
        error.value = 'Invalid username or password'
    } finally {
        loading.value = false
    }
}

/**
 * NEW: Handle "Continue as guest" => calls authStore.continueAsGuest,
 * then pushes to the loading screen (which will initialize a local-only DB).
 */
async function handleGuest() {
    loading.value = true
    error.value = ''
    try {
        await authStore.continueAsGuest()
        router.push({ name: 'loading', params: { timestamp: Date.now() } }) // Add timestamp to force reload
    } catch (err) {
        error.value = 'Failed to continue as guest.'
    } finally {
        loading.value = false
    }
}
</script>

<template>
    <div class="min-h-screen bg-gray-50 flex flex-col">
        <!-- Top Navigation Bar -->
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <h1 class="text-xl font-semibold text-gray-800">Sign In</h1>
            </div>
        </nav>

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
                                :disabled="loading" />
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
                                :disabled="loading" />
                        </div>
                    </div>

                    <!-- Error Message -->
                    <div v-if="error" class="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
                        {{ error }}
                    </div>

                    <!-- Submit Button -->
                    <div>
                        <button type="submit"
                            class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            :disabled="loading">
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

                    <!-- Sign Up Link -->
                    <div class="text-sm text-center">
                        <router-link to="/signup" class="font-medium text-gray-600 hover:text-gray-900">
                            Don't have an account? Sign up
                        </router-link>
                    </div>
                </form>

                <!-- Continue as guest -->
                <div class="mt-4">
                    <button type="button"
                        class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-gray-700 bg-gray-200 hover:bg-gray-300"
                        @click="handleGuest">
                        Continue as guest
                    </button>
                </div>

                <!-- Terms of Service link -->
                <div class="text-sm text-center mt-4">
                    <router-link to="/terms" class="font-medium text-gray-600 hover:text-gray-900">
                        Terms of Service
                    </router-link>
                </div>

            </div>
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
        router.push('/loading')
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
        router.push('/loading')
    } catch (err) {
        error.value = 'Failed to continue as guest.'
    } finally {
        loading.value = false
    }
}
</script>

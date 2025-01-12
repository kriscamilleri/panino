<template>
    <div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div class="max-w-md w-full space-y-8">
            <div>
                <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
                    Create your account
                </h2>
            </div>
            <form class="mt-8 space-y-6" @submit.prevent="handleSubmit">
                <div class="rounded-md shadow-sm -space-y-px">
                    <div>
                        <label for="username" class="sr-only">Username</label>
                        <input id="username" v-model="username" name="username" type="text" required
                            class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                            placeholder="Username">
                    </div>
                    <div>
                        <label for="password" class="sr-only">Password</label>
                        <input id="password" v-model="password" name="password" type="password" required
                            class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                            placeholder="Password">
                    </div>
                    <div>
                        <label for="confirmPassword" class="sr-only">Confirm Password</label>
                        <input id="confirmPassword" v-model="confirmPassword" name="confirmPassword" type="password"
                            required
                            class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                            placeholder="Confirm Password">
                    </div>
                </div>

                <div>
                    <button type="submit"
                        class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        :disabled="loading">
                        {{ loading ? 'Creating account...' : 'Sign up' }}
                    </button>
                </div>

                <div v-if="error" class="text-red-500 text-center text-sm">
                    {{ error }}
                </div>

                <div class="text-sm text-center">
                    <router-link to="/login" class="font-medium text-indigo-600 hover:text-indigo-500">
                        Already have an account? Sign in
                    </router-link>
                </div>
            </form>
        </div>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAuthStore } from '../store/authStore'
import { useDocStore } from '../store/docStore'
import { useRouter } from 'vue-router'

const authStore = useAuthStore()
const docStore = useDocStore()
const router = useRouter()

const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')

const isValid = computed(() => {
    return username.value.length >= 3 &&
        password.value.length >= 6 &&
        password.value === confirmPassword.value
})

async function handleSubmit() {
    if (!isValid.value) {
        error.value = password.value !== confirmPassword.value
            ? 'Passwords do not match'
            : 'Username must be at least 3 characters and password at least 6 characters'
        return
    }

    loading.value = true
    error.value = ''

    try {
        console.log('Starting signup process...')
        await authStore.signup(username.value, password.value)
        console.log('Signup successful, attempting login...')
        await authStore.login(username.value, password.value)
        console.log('Login successful, initializing CouchDB...')
        await docStore.initCouchDB()
        console.log('All steps completed, redirecting...')
        router.push('/')
    } catch (err) {
        console.error('Signup process error:', err)
        error.value = err.message || 'Failed to create account. Please try again.'
        if (err.message.includes('conflict')) {
            error.value = 'Username already exists. Please choose another.'
        }
    } finally {
        loading.value = false
    }
}
</script>
// /frontend/src/store/authStore.js
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useSyncStore } from './syncStore';
import { useDocStore } from './docStore';

const AUTH_SERVICE_URL = import.meta.env.VITE_AUTH_SERVICE_URL || 'http://localhost:8000';
const SIGNUP_SERVICE_URL = import.meta.env.VITE_SIGNUP_SERVICE_URL || 'http://localhost:3000';

export const useAuthStore = defineStore('authStore', () => {
    const token = ref(localStorage.getItem('jwt_token'));
    const user = ref(null);

    const isAuthenticated = computed(() => !!token.value);
    const powersyncToken = computed(() => token.value);

    watch(token, (newToken) => {
        const syncStore = useSyncStore();
        if (newToken) {
            localStorage.setItem('jwt_token', newToken);
            try {
                const payload = JSON.parse(atob(newToken.split('.')[1]));
                user.value = { id: payload.user_id, email: payload.email };
            } catch (e) {
                console.error("Failed to decode JWT:", e);
                user.value = null;
                token.value = null;
            }
        } else {
            localStorage.removeItem('jwt_token');
            user.value = null;
            // When logging out, explicitly disconnect
            if (syncStore.powerSync?.value) {
                syncStore.powerSync.value.disconnect();
            }
        }
    }, { immediate: true });

    async function signup(email, password, turnstileToken = '') {
        const response = await fetch(`${SIGNUP_SERVICE_URL}/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, 'cf-turnstile-response': turnstileToken }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.details || data.error || 'Signup failed');
        }
        return data;
    }

    async function login(email, password) {
        const response = await fetch(`${AUTH_SERVICE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Login failed');
        }

        // Disconnect and clear the database of the PREVIOUS session.
        const syncStore = useSyncStore();
        if (syncStore.isInitialized) {
            await syncStore.resetDatabase(); // This should now ONLY clear, not re-initialize
        }

        // Set the new token. The UI will navigate to /loading, which handles initialization.
        token.value = data.token;
    }

    async function logout() {
        // Clear the local state and database
        const docStore = useDocStore();
        await docStore.resetStore();

        // Clear the token, which triggers the watcher to update localStorage
        token.value = null;
    }

    async function checkAuth() {
        token.value = localStorage.getItem('jwt_token');
    }

    return {
        token, user, isAuthenticated, powersyncToken,
        signup, login, logout, checkAuth
    };
});
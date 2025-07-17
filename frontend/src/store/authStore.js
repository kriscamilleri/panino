// /frontend/src/store/authStore.js
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useSyncStore } from './syncStore';
import { useDocStore } from './docStore';

const AUTH_SERVICE_URL = import.meta.env.VITE_AUTH_SERVICE_URL || 'http://localhost:8000';
const SIGNUP_SERVICE_URL = import.meta.env.VITE_SIGNUP_SERVICE_URL || 'http://localhost:3000';

export const useAuthStore = defineStore('authStore', () => {
    const token = ref(localStorage.getItem('jwt_token'));
    const user = ref(null); // Will hold { id, email }

    const isAuthenticated = computed(() => !!token.value);
    const powersyncToken = computed(() => token.value);

    // This watcher is the central point for handling auth state changes.
    watch(token, (newToken) => {
        const syncStore = useSyncStore();
        if (newToken) {
            localStorage.setItem('jwt_token', newToken);
            try {
                const payload = JSON.parse(atob(newToken.split('.')[1]));
                user.value = { id: payload.user_id, email: payload.email }; // Assuming email is in token
            } catch (e) {
                console.error("Failed to decode JWT:", e);
                user.value = null;
                token.value = null; // Clear invalid token
            }
        } else {
            localStorage.removeItem('jwt_token');
            user.value = null;
        }
        // Always trigger PowerSync to connect or disconnect based on the new token state.
        if (syncStore.isInitialized) {
            syncStore.handleConnectionState();
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
        // Signup success, client should now log in.
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

        // On successful login, clear any old data and set the new token.
        const docStore = useDocStore();
        await docStore.resetStore();
        token.value = data.token; // The watcher will handle the rest.
    }

    async function logout() {
        const docStore = useDocStore();
        await docStore.resetStore();
        token.value = null; // The watcher will disconnect PowerSync.
    }

    // Called by the global route guard to initialize auth state on page load.
    async function checkAuth() {
        // This is now simpler: just load from localStorage. The watcher does the work.
        token.value = localStorage.getItem('jwt_token');
    }

    return {
        token,
        user,
        isAuthenticated,
        powersyncToken,
        signup,
        login,
        logout,
        checkAuth
    };
});
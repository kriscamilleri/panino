// /frontend/src/store/authStore.js
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useSyncStore } from './syncStore';
import { useDocStore } from './docStore';

// The single, unified API URL
const API_SERVICE_URL = import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000';

export const useAuthStore = defineStore('authStore', () => {
    const token = ref(localStorage.getItem('jwt_token'));
    const user = ref(null);

    const isAuthenticated = computed(() => !!token.value);

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
            if (syncStore.isInitialized) {
                syncStore.resetDatabase();
            }
        }
    }, { immediate: true });

    async function signup(email, password, turnstileToken = '') {
        // Corrected URL: points to the main api-service
        const response = await fetch(`${API_SERVICE_URL}/signup`, {
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
        const response = await fetch(`${API_SERVICE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Login failed');

        const syncStore = useSyncStore();
        if (syncStore.isInitialized) await syncStore.resetDatabase();

        token.value = data.token;

        // ✅ CONNECT: Establish WebSocket after getting the token
        syncStore.connectWebSocket();
    }

    async function logout() {
        // ✅ DISCONNECT: Close WebSocket before clearing data
        const syncStore = useSyncStore();
        syncStore.disconnectWebSocket();

        const docStore = useDocStore();
        await docStore.resetStore();
        token.value = null;
    }

    async function checkAuth() {
        token.value = localStorage.getItem('jwt_token');
        // ✅ CONNECT on app load if already authenticated
        if (isAuthenticated.value) {
            useSyncStore().connectWebSocket();
        }
    }

    return {
        token, user, isAuthenticated,
        signup, login, logout, checkAuth
    };
});
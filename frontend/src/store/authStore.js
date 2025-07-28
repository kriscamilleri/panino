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
                // Store basic info from token, full profile fetched separately
                user.value = { id: payload.user_id, name: payload.name, email: payload.email };
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

    async function signup(name, email, password, turnstileToken = '') {
        const response = await fetch(`${API_SERVICE_URL}/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password, 'cf-turnstile-response': turnstileToken }),
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
        syncStore.connectWebSocket();
    }

    async function logout() {
        const syncStore = useSyncStore();
        syncStore.disconnectWebSocket();

        const docStore = useDocStore();
        await docStore.resetStore();
        token.value = null;
    }

    async function checkAuth() {
        token.value = localStorage.getItem('jwt_token');
        if (isAuthenticated.value) {
            useSyncStore().connectWebSocket();
        }
    }

    async function fetchMe() {
        if (!isAuthenticated.value) return;
        const response = await fetch(`${API_SERVICE_URL}/me`, {
            headers: { Authorization: `Bearer ${token.value}` }
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch user profile');
        user.value = { ...user.value, ...data }; // Merge with existing data
        return user.value;
    }

    async function updatePassword(currentPassword, newPassword) {
        const response = await fetch(`${API_SERVICE_URL}/me/password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to update password');
        return data;
    }

    async function forgotPassword(email) {
        const response = await fetch(`${API_SERVICE_URL}/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Request failed');
        return data;
    }

    async function resetPassword(token, newPassword) {
        const response = await fetch(`${API_SERVICE_URL}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, newPassword })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Password reset failed');
        return data;
    }

    return {
        token, user, isAuthenticated,
        signup, login, logout, checkAuth,
        fetchMe, // ✅ FIX: Expose the fetchMe function
        updatePassword, forgotPassword, resetPassword
    };
});
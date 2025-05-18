<template>
    <AuthForm :config="loginConfig" />
</template>

<script setup>
import AuthForm from './AuthForm.vue';
import { useAuthStore } from '../store/authStore';

const authStore = useAuthStore();
const loginConfig = {
    type: 'login',
    title: 'Sign In',
    fields: [
        { name: 'username', label: 'Username', type: 'text', required: true },
        { name: 'password', label: 'Password', type: 'password', required: true }
    ],
    submitText: 'Sign In',
    loadingText: 'Signing in...',
    submitAction: async (formData) => authStore.login(formData.username, formData.password),
    showGuestButton: true,
    guestAction: async () => authStore.continueAsGuest(),
    link: { to: '/signup', text: "Don't have an account? Sign up" }
};
</script>
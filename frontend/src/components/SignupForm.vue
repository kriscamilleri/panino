<template>
    <AuthForm :config="signupConfig" />
</template>

<script setup>
import AuthForm from './AuthForm.vue';
import { useAuthStore } from '@/store/authStore';

const authStore = useAuthStore();
const signupConfig = {
    type: 'signup',
    title: 'Sign Up',
    fields: [
        { name: 'username', label: 'Username', type: 'text', required: true, minLength: 3 },
        { name: 'password', label: 'Password', type: 'password', required: true, minLength: 6 },
        { name: 'confirmPassword', label: 'Confirm Password', type: 'password', required: true, matches: 'password' }
    ],
    submitText: 'Create account',
    loadingText: 'Creating account...',
    submitAction: async (formData, turnstileToken) => {
        // Signup and then login
        await authStore.signup(formData.username, formData.password, turnstileToken || '');
        await authStore.login(formData.username, formData.password);
    },
    showPasswordRequirements: true,
    showTurnstile: !!import.meta.env.VITE_TURNSTILE_SITE_KEY,
    link: { to: '/login', text: 'Already have an account? Sign in' }
};
</script>
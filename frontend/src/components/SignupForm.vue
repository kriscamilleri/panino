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
        { name: 'email', label: 'Email Address', type: 'email', required: true },
        { name: 'password', label: 'Password', type: 'password', required: true, minLength: 6 },
        { name: 'confirmPassword', label: 'Confirm Password', type: 'password', required: true, matches: 'password' }
    ],
    submitText: 'Create account',
    loadingText: 'Creating account...',
    submitAction: async (formData, turnstileToken) => {
        // Signup and then login
        await authStore.signup(formData.email, formData.password, turnstileToken || '');
        await authStore.login(formData.email, formData.password);
    },
    showPasswordRequirements: true,
    showTurnstile: !!import.meta.env.VITE_TURNSTILE_SITE_KEY,
    link: { to: '/login', text: 'Already have an account? Sign in' }
};
</script>
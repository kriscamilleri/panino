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
        { name: 'email', label: 'Email Address', type: 'email', required: true },
        { name: 'password', label: 'Password', type: 'password', required: true }
    ],
    submitText: 'Sign In',
    loadingText: 'Signing in...',
    submitAction: async (formData) => authStore.login(formData.email, formData.password),
    link: { to: '/signup', text: "Don't have an account? Sign up" }
};
</script>
<template>
       
    <AuthForm :config="forgotPasswordConfig" />
</template>

<script setup>
import AuthForm from '@/components/AuthForm.vue';
import { useAuthStore } from '@/store/authStore';

const authStore = useAuthStore();

const forgotPasswordConfig = {
    type: 'forgot-password',
    title: 'Forgot Password',
    fields: [
        { name: 'email', label: 'Enter your account email', type: 'email', required: true }
    ],
    submitText: 'Send Reset Link',
    loadingText: 'Sending...',
    submitAction: async (formData) => authStore.forgotPassword(formData.email),
    link: { to: '/login', text: 'Back to Sign In' }
};
</script>
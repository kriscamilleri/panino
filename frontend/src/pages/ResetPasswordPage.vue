<template>
    <AuthForm :config="resetPasswordConfig" />
</template>

<script setup>
import AuthForm from '@/components/AuthForm.vue';
import { useAuthStore } from '@/store/authStore';
import { useRouter } from 'vue-router';

const props = defineProps({
    token: { type: String, required: true }
});

const authStore = useAuthStore();
const router = useRouter();

const resetPasswordConfig = {
    type: 'reset-password',
    title: 'Reset Your Password',
    fields: [
        { name: 'newPassword', label: 'New Password', type: 'password', required: true, minLength: 6 },
        { name: 'confirmPassword', label: 'Confirm New Password', type: 'password', required: true, matches: 'newPassword' }
    ],
    submitText: 'Set New Password',
    loadingText: 'Resetting...',
    submitAction: async (formData) => {
        const result = await authStore.resetPassword(props.token, formData.newPassword);
        // After success, redirect to login
        setTimeout(() => {
            router.push('/login');
        }, 2000); // Wait 2s to let user read success message
        return result;
    },
    link: { to: '/login', text: 'Back to Sign In' },
    showPasswordRequirements: true,
};
</script>
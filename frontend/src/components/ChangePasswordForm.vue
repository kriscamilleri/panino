<template>
    <form class="space-y-6 mt-6" @submit.prevent="handleSubmit">
        <div>
            <label for="currentPassword" class="block text-sm font-medium text-gray-700">Current Password</label>
            <div class="mt-1">
                <input id="currentPassword" v-model="formData.currentPassword" type="password" required
                    class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                    :disabled="loading" />
            </div>
        </div>

        <div>
            <label for="newPassword" class="block text-sm font-medium text-gray-700">New Password</label>
            <div class="mt-1">
                <input id="newPassword" v-model="formData.newPassword" type="password" required
                    class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                    :disabled="loading" :class="{ 'border-red-300': formErrors.newPassword }" />
                <p v-if="formErrors.newPassword" class="mt-1 text-sm text-red-600">
                    {{ formErrors.newPassword }}
                </p>
            </div>
        </div>

        <div>
            <label for="confirmNewPassword" class="block text-sm font-medium text-gray-700">Confirm New Password</label>
            <div class="mt-1">
                <input id="confirmNewPassword" v-model="formData.confirmNewPassword" type="password" required
                    class="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                    :disabled="loading" :class="{ 'border-red-300': formErrors.confirmNewPassword }" />
                <p v-if="formErrors.confirmNewPassword" class="mt-1 text-sm text-red-600">
                    {{ formErrors.confirmNewPassword }}
                </p>
            </div>
        </div>

        <div class="rounded-md bg-gray-50 p-4">
            <div class="text-sm text-gray-700">
                <h4 class="font-medium mb-2">Password Requirements:</h4>
                <ul class="space-y-1">
                    <li class="flex items-center gap-2">
                        <span class="text-lg" :class="passwordLengthValid ? 'text-green-700' : 'text-gray-300'">●</span>
                        At least 6 characters
                    </li>
                </ul>
            </div>
        </div>

        <div v-if="error" class="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
            {{ error }}
        </div>

        <div v-if="successMessage"
            class="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md text-sm">
            {{ successMessage }}
        </div>

        <div>
            <button type="submit"
                class="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="loading || !isFormValid">
                <template v-if="loading">
                    <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg"
                        fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                        </circle>
                        <path class="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                        </path>
                    </svg>
                    Updating...
                </template>
                <template v-else>Update Password</template>
            </button>
        </div>
    </form>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useAuthStore } from '@/store/authStore';

const authStore = useAuthStore();

const formData = ref({
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
});
const loading = ref(false);
const error = ref('');
const successMessage = ref('');
const formErrors = ref({});

// Validation logic
watch(formData, () => {
    formErrors.value = {};
    if (formData.value.newPassword && formData.value.newPassword.length < 6) {
        formErrors.value.newPassword = 'New password must be at least 6 characters long.';
    }
    if (formData.value.confirmNewPassword && formData.value.newPassword !== formData.value.confirmNewPassword) {
        formErrors.value.confirmNewPassword = 'Passwords do not match.';
    }
}, { deep: true });

const passwordLengthValid = computed(() => formData.value.newPassword.length >= 6);

const isFormValid = computed(() => {
    return !Object.keys(formErrors.value).length &&
        formData.value.currentPassword &&
        formData.value.newPassword &&
        formData.value.confirmNewPassword;
});

async function handleSubmit() {
    if (!isFormValid.value) return;
    loading.value = true;
    error.value = '';
    successMessage.value = '';

    try {
        const result = await authStore.updatePassword(formData.value.currentPassword, formData.value.newPassword);
        if (result?.message) {
            successMessage.value = result.message;
            // Clear form on success
            Object.keys(formData.value).forEach(key => formData.value[key] = '');
        }
    } catch (err) {
        console.error('Password update error:', err);
        error.value = err.message || 'Failed to update password. Please try again.';
    } finally {
        loading.value = false;
    }
}
</script>
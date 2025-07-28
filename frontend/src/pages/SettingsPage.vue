<template>
    <AccountLayout title="Account Settings">
        <div class="border-b pb-6 mb-6">
            <h2 class="text-lg font-medium text-gray-900 mb-4">Profile Information</h2>
            <div v-if="loadingProfile">Loading...</div>
            <div v-else-if="user" class="space-y-4 text-sm">
                <div>
                    <strong class="block text-gray-800">Name</strong>
                    <span class="text-gray-600">{{ user.name }}</span>
                </div>
                <div>
                    <strong class="block text-gray-800">Email</strong>
                    <span class="text-gray-600">{{ user.email }}</span>
                </div>
                <div>
                    <strong class="block text-gray-800">User ID</strong>
                    <code class="text-xs bg-gray-100 p-1 rounded text-gray-700">{{ user.id }}</code>
                </div>
                <div>
                    <strong class="block text-gray-800">Member since</strong>
                    <span class="text-gray-600">{{ new Date(user.created_at).toLocaleDateString() }}</span>
                </div>
            </div>
            <div v-else class="text-gray-500">
                Could not load profile information.
            </div>
        </div>

        <div>
            <h2 class="text-lg font-medium text-gray-900">Change Password</h2>
            <ChangePasswordForm />
        </div>
    </AccountLayout>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@/store/authStore';
import AccountLayout from '@/components/AccountLayout.vue';
import ChangePasswordForm from '@/components/ChangePasswordForm.vue';

const authStore = useAuthStore();
const { user } = storeToRefs(authStore);
const loadingProfile = ref(true);

onMounted(async () => {
    try {
        // fetchMe might not be called before, so ensure it is.
        if (!user.value || !user.value.created_at) {
            await authStore.fetchMe();
        }
    } catch (error) {
        console.error('Failed to fetch profile', error);
    } finally {
        loadingProfile.value = false;
    }
});
</script>
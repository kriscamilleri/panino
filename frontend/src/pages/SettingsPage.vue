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
                <div>
                    <strong class="block text-gray-800">Database size</strong>
                    <span class="text-gray-600">{{ formatBytes(user.database_size_bytes) }}</span>
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

        <div class="mt-8 border-t pt-6">
            <h2 class="text-lg font-medium text-gray-900 mb-3">Tools</h2>
            <BaseButton @click="goToImages" data-testid="settings-images-button">
                <Image class="w-4 h-4" />
                <span>Manage Images</span>
            </BaseButton>
        </div>
    </AccountLayout>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@/store/authStore';
import AccountLayout from '@/components/AccountLayout.vue';
import ChangePasswordForm from '@/components/ChangePasswordForm.vue';
import BaseButton from '@/components/BaseButton.vue';
import { Image } from 'lucide-vue-next';

const authStore = useAuthStore();
const router = useRouter();
const { user } = storeToRefs(authStore);
const loadingProfile = ref(true);

function goToImages() {
    router.push('/images');
}

function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) {
        return 'Unknown';
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    const units = ['KB', 'MB', 'GB', 'TB'];
    let unitIndex = -1;
    let formattedValue = bytes;

    do {
        formattedValue /= 1024;
        unitIndex += 1;
    } while (formattedValue >= 1024 && unitIndex < units.length - 1);

    return `${formattedValue.toFixed(formattedValue >= 10 || unitIndex === 0 ? 1 : 2)} ${units[unitIndex]}`;
}

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
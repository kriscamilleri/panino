<template>
    <!-- Notice: we do NOT do another v-if here -->
    <div class="md:hidden border-t bg-gray-50">
        <div class="px-4 py-2 space-y-2">
            <!-- Show user name if authenticated -->
            <div v-if="authStore.isAuthenticated" class="text-gray-500 py-2 px-2"
                data-testid="mobile-menu-username-display">
                {{
                    authStore.user?.name.replace(/\b\w/g, char => char.toUpperCase())
                    || 'Guest'
                }}
            </div>

            <!-- Sync Button (only if authenticated and not a guest) -->
            <div v-if="authStore.isAuthenticated && authStore.user?.name !== 'guest'" class="px-2">
                <BaseButton 
                    :isActive="syncStore.syncEnabled" 
                    :disabled="!authStore.isAuthenticated"
                    @click="handleToggleSync" 
                    class="w-full space-x-1"
                    data-testid="mobile-menu-sync-button">
                    <RefreshCw class="w-4 h-4" />
                    <span>Sync {{ syncStore.syncEnabled ? 'On' : 'Off' }}</span> <!-- Clarify state -->
                </BaseButton>
            </div>

            <!-- About link -->
            <a href="https://github.com/kriscamilleri/pn-markdown-notes" target="_blank"
                class="flex items-center space-x-2 mx-2" data-testid="mobile-menu-about-link">
                <Info class="w-4 h-4" title="About" />
                <span>About</span>
            </a>

            <!-- Login/Logout -->
            <div class="py-2">
                <BaseButton v-if="!authStore.isAuthenticated" @click="goToLogin" class="w-full"
                    data-testid="mobile-menu-login-button">
                    <LogIn class="w-4 h-4" title="Login" />
                    <span>Login</span>
                </BaseButton>
                <BaseButton v-else @click="handleLogout" class="w-full" data-testid="mobile-menu-logout-button">
                    <LogOut class="w-4 h-4" title="Logout" />
                    <span>Logout</span>
                </BaseButton>
            </div>
        </div>
    </div>
</template>

<script setup>
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { useRouter } from 'vue-router'
import BaseButton from '@/components/BaseButton.vue'
import { RefreshCw, Info, LogIn, LogOut } from 'lucide-vue-next'

const emit = defineEmits(['close'])
const authStore = useAuthStore()
const syncStore = useSyncStore()
const uiStore = useUiStore()
const router = useRouter()

async function handleToggleSync() {
    if (!syncStore.syncEnabled) {
        // If sync is disabled due to auth failure, try to refresh token first
        if (!authStore.isAuthenticated) {
            uiStore.addToast('Please log in again to enable sync.', 'warning');
            return;
        }
        
        // Try refreshing the token if sync was disabled
        console.log('[MobileMenu] Attempting to refresh token before enabling sync...');
        const refreshed = await authStore.refreshToken();
        if (!refreshed) {
            uiStore.addToast('Session expired. Please log in again to enable sync.', 'warning');
            return;
        }
    }
    
    syncStore.setSyncEnabled(!syncStore.syncEnabled);
}

async function handleLogout() {
    try {
        await authStore.logout()
        router.push('/login')
    } catch (err) {
        console.error('Error logging out:', err)
    } finally {
        emit('close')
    }
}

function goToLogin() {
    router.push('/login')
    emit('close')
}
</script>
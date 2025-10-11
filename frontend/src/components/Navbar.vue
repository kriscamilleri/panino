<template>
    <nav class="bg-gray-100 border-b">
        <div class="flex items-center justify-between px-4 py-2">
            <div class="flex items-center space-x-4">

                <BaseButton :isActive="ui.showViewMenu" @click="ui.toggleViewMenu()" title="Toggle View Menu"
                    data-testid="navbar-view-button">

                    <Layout class="md:w-4 md:h-4 w-5 h-5" />
                    <span class="hidden md:inline">View</span>

                </BaseButton>

                <BaseButton :isActive="ui.showActionBar" @click="ui.toggleActionBar()" title="Toggle Editor"
                    data-testid="navbar-editor-button">

                    <Paintbrush class="md:w-4 md:h-4 w-5 h-5" />
                    <span class="hidden md:inline">Editor</span>

                </BaseButton>

                <BaseButton :isActive="ui.showFileMenu" @click="ui.toggleFileMenu()" title="Toggle File Menu"
                    data-testid="navbar-tools-button">

                    <FileIcon class="md:w-4 md:h-4 w-5 h-5" />
                    <span class="hidden md:inline">Tools</span>

                </BaseButton>

                <BaseButton v-if="authStore.isAuthenticated && authStore.user?.name !== 'guest'"
                    :isActive="syncStore.syncEnabled" 
                    :disabled="!authStore.isAuthenticated"
                    @click="handleToggleSync" 
                    class="space-x-1" 
                    title="Toggle Sync"
                    data-testid="navbar-sync-button">

                    <RefreshCw :class="syncStore.syncEnabled ? '' : 'text-red-500'" class="w-4 h-4 " />
                    <span class="hidden md:inline">Sync {{ syncStore.syncEnabled ? 'On' : 'Off'
                    }}</span>

                </BaseButton>
            </div>

            <div class="flex items-center space-x-4">
                <div class="hidden md:flex items-center space-x-4">
                    <router-link v-if="authStore.isAuthenticated" to="/settings"
                        class="px-2 py-1 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-1 transition"
                        data-testid="navbar-username-display">

                        <User class="w-4 h-4" />
                        <span>{{ authStore.user?.name || authStore.user?.email ||
                            authStore.user?.id }}</span>

                    </router-link>

                    <a href="https://github.com/kriscamilleri/pn-markdown-notes" target="_blank"
                        class="flex items-center space-x-1 transition text-gray-700 hover:bg-gray-200 rounded px-2 py-1"
                        data-testid="navbar-about-link">
                        <Info class="w-4 h-4" title="About" />
                        <span>About</span>

                    </a>

                    <BaseButton v-if="!authStore.isAuthenticated" @click="goToLogin" class="space-x-1"
                        data-testid="navbar-login-button">

                        <LogIn class="w-4 h-4" title="Login" />
                        <span>Login</span>

                    </BaseButton>
                    <BaseButton v-else @click="handleLogout" class="space-x-1" data-testid="navbar-logout-button">

                        <LogOut class="w-4 h-4" title="Logout" />
                        <span>Logout</span>

                    </BaseButton>
                </div>

                <div class="md:hidden">
                    <BaseButton @click="toggleMobileMenu" data-testid="navbar-mobile-menu-button">

                        <Menu class="w-6 h-6" />

                    </BaseButton>
                </div>
            </div>
        </div>

        <transition name="fade-fast" mode="out-in">

            <MobileMenu v-if="isMobileMenuOpen" @close="toggleMobileMenu" data-testid="mobile-menu-component" />

        </transition>
    </nav>
</template>

<script setup>
import { ref } from 'vue'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/BaseButton.vue'
import MobileMenu from './MobileMenu.vue'

import {
    Paintbrush,
    Layout,
    FileIcon,
    RefreshCw,
    Info,
    LogIn,
    LogOut,
    Menu,
    User
} from 'lucide-vue-next'

const ui = useUiStore()
const authStore = useAuthStore()
const syncStore = useSyncStore()
const router = useRouter()

const isMobileMenuOpen = ref(false)

function toggleMobileMenu() {
    isMobileMenuOpen.value = !isMobileMenuOpen.value
}

async function handleToggleSync() {
    if (!syncStore.syncEnabled) {
        // If sync is disabled due to auth failure, try to refresh token first
        if (!authStore.isAuthenticated) {
            const uiStore = useUiStore();
            uiStore.addToast('Please log in again to enable sync.', 'warning');
            return;
        }
        
        // Try refreshing the token if sync was disabled
        console.log('[Navbar] Attempting to refresh token before enabling sync...');
        const refreshed = await authStore.refreshToken();
        if (!refreshed) {
            const uiStore = useUiStore();
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
    }
}

function goToLogin() {
    router.push('/login')
}
</script>

<style scoped>
/* Ensure BaseButton styling applies correctly to the About link */
a[data-testid="navbar-about-link"] {
    display: inline-flex;
    align-items: center;
}
</style>
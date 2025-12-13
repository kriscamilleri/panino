<template>
    <nav class="bg-gray-100 border-b">
        <div class="flex items-center justify-between px-4 py-2">
            <div class="flex items-center space-x-4">

                <BaseButton
                    :isActive="ui.showViewMenu"
                    @click="ui.toggleViewMenu()"
                    title="Toggle View Menu"
                    data-testid="navbar-view-button"
                >

                    <Layout class="md:w-4 md:h-4 w-5 h-5" />
                    <span class="hidden md:inline">View</span>

                </BaseButton>

                <BaseButton
                    :isActive="ui.showActionBar"
                    @click="ui.toggleActionBar()"
                    title="Toggle Editor"
                    data-testid="navbar-editor-button"
                >

                    <Paintbrush class="md:w-4 md:h-4 w-5 h-5" />
                    <span class="hidden md:inline">Editor</span>

                </BaseButton>

                <BaseButton
                    :isActive="ui.showFileMenu"
                    @click="ui.toggleFileMenu()"
                    title="Toggle File Menu"
                    data-testid="navbar-tools-button"
                >

                    <FileIcon class="md:w-4 md:h-4 w-5 h-5" />
                    <span class="hidden md:inline">Tools</span>

                </BaseButton>

                <div
                    class="flex items-center px-3"
                    style="min-width: 80px;"
                >
                    <div
                        v-if="docStore.isSaving"
                        class="flex items-center text-blue-600 text-xs font-medium"
                    >
                        <Cloud class="w-3 h-3 mr-1 animate-pulse" />
                        Saving
                    </div>
                    <div
                        v-else
                        class="flex items-center text-green-600 text-xs font-medium transition-opacity duration-500"
                    >
                        <CheckCircle class="w-3 h-3 mr-1" />
                        Saved
                    </div>
                </div>

                <BaseButton
                    v-if="authStore.isAuthenticated && authStore.user?.name !== 'guest'"
                    :isActive="syncStore.syncEnabled"
                    :disabled="!authStore.isAuthenticated || !syncStore.isOnline"
                    @click="handleToggleSync"
                    class="space-x-1"
                    :title="!syncStore.isOnline ? 'Offline - Sync unavailable' : syncStore.isSyncing ? 'Syncing...' : 'Toggle Sync'"
                    data-testid="navbar-sync-button"
                >

                    <RefreshCw
                        :class="[
                            !syncStore.isOnline ? 'text-gray-400' : syncStore.syncEnabled ? '' : 'text-red-500',
                            syncStore.isSyncing ? 'animate-spin' : ''
                        ]"
                        class="w-4 h-4"
                    />
                    <span class="hidden md:inline">
                        <span v-if="!syncStore.isOnline">Offline</span>
                        <span v-else-if="syncStore.isSyncing">Syncing...</span>
                        <span v-else>Sync {{ syncStore.syncEnabled ? 'On' : 'Off' }}</span>
                    </span>

                </BaseButton>
            </div>

            <div class="flex items-center space-x-4">
                <div class="hidden md:flex items-center space-x-4">
                    <router-link
                        v-if="authStore.isAuthenticated"
                        to="/settings"
                        custom
                        v-slot="{ navigate }"
                    >
                        <BaseButton
                            @click="navigate"
                            data-testid="navbar-username-display"
                        >
                            <User class="w-4 h-4" />
                            <span>{{ authStore.user?.name || authStore.user?.email ||
                                authStore.user?.id }}</span>
                        </BaseButton>
                    </router-link>

                    <BaseButton
                        as="a"
                        href="https://github.com/kriscamilleri/pn-markdown-notes"
                        target="_blank"
                        data-testid="navbar-about-link"
                    >
                        <Info
                            class="w-4 h-4"
                            title="About"
                        />
                        <span>About</span>
                    </BaseButton>

                    <BaseButton
                        v-if="!authStore.isAuthenticated"
                        @click="goToLogin"
                        class="space-x-1"
                        data-testid="navbar-login-button"
                    >

                        <LogIn
                            class="w-4 h-4"
                            title="Login"
                        />
                        <span>Login</span>

                    </BaseButton>
                    <BaseButton
                        v-else
                        @click="handleLogout"
                        class="space-x-1"
                        data-testid="navbar-logout-button"
                    >

                        <LogOut
                            class="w-4 h-4"
                            title="Logout"
                        />
                        <span>Logout</span>

                    </BaseButton>
                </div>

                <div class="md:hidden">
                    <BaseButton
                        @click="toggleMobileMenu"
                        data-testid="navbar-mobile-menu-button"
                    >

                        <Menu class="w-6 h-6" />

                    </BaseButton>
                </div>
            </div>
        </div>

        <transition
            name="fade-fast"
            mode="out-in"
        >

            <MobileMenu
                v-if="isMobileMenuOpen"
                @close="toggleMobileMenu"
                data-testid="mobile-menu-component"
            />

        </transition>
    </nav>
</template>

<script setup>
import { ref } from 'vue'
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/BaseButton.vue'
import MobileMenu from './MobileMenu.vue'

import {
    Cloud,
    CheckCircle,
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

const docStore = useDocStore()
const ui = useUiStore()
const authStore = useAuthStore()
const syncStore = useSyncStore()
const router = useRouter()

const isMobileMenuOpen = ref(false)

function toggleMobileMenu() {
    isMobileMenuOpen.value = !isMobileMenuOpen.value
}

async function handleToggleSync() {
    const uiStore = useUiStore();

    // Check if offline first
    if (!syncStore.isOnline) {
        uiStore.addToast('Cannot sync while offline. Changes will sync when you reconnect.', 'warning');
        return;
    }

    // Check authentication
    if (!authStore.isAuthenticated) {
        uiStore.addToast('Please log in again to enable sync.', 'warning');
        return;
    }

    // If trying to enable sync (currently disabled)
    if (!syncStore.syncEnabled) {
        // Try refreshing the token if sync was disabled due to auth failure
        console.log('[Navbar] Attempting to refresh token before enabling sync...');
        const refreshed = await authStore.refreshToken();
        if (!refreshed) {
            uiStore.addToast('Session expired. Please log in again to enable sync.', 'warning');
            return;
        }

        // Enable sync and show success message
        syncStore.setSyncEnabled(true);
        uiStore.addToast('Sync enabled. Your notes will sync automatically.', 'success', 3000);
    } else {
        // Disable sync
        syncStore.setSyncEnabled(false);
        uiStore.addToast('Sync disabled. Changes will be stored locally only.', 'info', 3000);
    }
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

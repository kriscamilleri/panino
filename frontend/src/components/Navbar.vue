<template>
    <nav class="bg-gray-100 border-b">
        <div class="flex items-center justify-between px-4 py-2">
            <!-- Left side -->
            <div class="flex items-center space-x-4">

                <!-- View -->
                <BaseButton :isActive="ui.showViewMenu" @click="ui.toggleViewMenu()" title="Toggle View Menu"
                    data-testid="navbar-view-button">
                    <Layout class="md:w-4 md:h-4 w-5 h-5" />
                    <span class="hidden md:inline">View</span>
                </BaseButton>

                <!-- Document (formerly Format) -->
                <BaseButton :isActive="ui.showActionBar" @click="ui.toggleActionBar()" title="Toggle Document"
                    data-testid="navbar-document-button">
                    <Paintbrush class="md:w-4 md:h-4 w-5 h-5" />
                    <span class="hidden md:inline">Document</span>
                </BaseButton>

                <!-- Tools -->
                <BaseButton :isActive="ui.showFileMenu" @click="ui.toggleFileMenu()" title="Toggle File Menu"
                    data-testid="navbar-tools-button">
                    <FileIcon class="md:w-4 md:h-4 w-5 h-5" />
                    <span class="hidden md:inline">Tools</span>
                </BaseButton>

                <!-- Sync Button (only if authenticated and not a guest) -->
                <BaseButton v-if="authStore.isAuthenticated && authStore.user?.name !== 'guest'"
                    :isActive="syncStore.syncEnabled" @click="handleToggleSync" class="space-x-1" title="Toggle Sync"
                    data-testid="navbar-sync-button">
                    <RefreshCw :class="syncStore.syncEnabled ? '' : 'text-red-500'" class="w-4 h-4 " />
                    <span class="hidden md:inline">Sync {{ syncStore.syncEnabled ? 'On' : 'Off' }}</span>
                    <!-- Clarify state -->
                </BaseButton>
            </div>

            <!-- Right side -->
            <div class="flex items-center space-x-4">
                <!-- Desktop menu items -->
                <div class="hidden md:flex items-center space-x-4">
                    <!-- Show user name if authenticated -->

                    <div v-if="authStore.isAuthenticated" class="text-gray-500" data-testid="navbar-username-display">
                        {{ authStore.user?.name || authStore.user?.email || authStore.user?.id }}
                    </div>

                    <!-- About link -->
                    <a href="https://github.com/kriscamilleri/pn-markdown-notes" target="_blank"
                        class="flex items-center space-x-1 transition text-gray-700 hover:bg-gray-200 rounded px-2 py-1"
                        data-testid="navbar-about-link"> <!-- Applied button style -->
                        <Info class="w-4 h-4" title="About" />
                        <span>About</span>
                    </a>

                    <!-- Login/Logout -->
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

                <!-- Mobile hamburger menu -->
                <div class="md:hidden">
                    <BaseButton @click="toggleMobileMenu" data-testid="navbar-mobile-menu-button">
                        <Menu class="w-6 h-6" />
                    </BaseButton>
                </div>
            </div>
        </div>

        <!-- Insert the MobileMenu as a child.
           You can also do the <transition> here if you prefer. -->
        <!-- Wrap in a transition if you want a fade animation -->
        <transition name="fade-fast" mode="out-in">
            <!-- Only render <MobileMenu> if isMobileMenuOpen is true -->
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
// Adjust import if you prefer storing these components in a different folder.

import {
    Paintbrush,
    Layout,
    FileIcon,
    RefreshCw,
    Info,
    LogIn,
    LogOut,
    Menu
} from 'lucide-vue-next'

const ui = useUiStore()
const authStore = useAuthStore()
const syncStore = useSyncStore()
const router = useRouter()

const isMobileMenuOpen = ref(false)

function toggleMobileMenu() {
    isMobileMenuOpen.value = !isMobileMenuOpen.value
}

function handleToggleSync() {
    // Enable or disable live sync
    syncStore.setSyncEnabled(!syncStore.syncEnabled)
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
    /* Match button layout */
    align-items: center;
    /* Match button layout */
}
</style>

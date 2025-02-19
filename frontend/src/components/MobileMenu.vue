<template>
    <!-- You can wrap this in <transition> in your parent if you want -->
    <transition name="fade-fast" mode="out-in">
        <div v-if="trueIsOpen" class="md:hidden border-t bg-gray-50">
            <div class="px-4 py-2 space-y-2">
                <!-- Show user name if authenticated -->
                <div v-if="authStore.isAuthenticated" class="text-gray-500 py-2 px-2">
                    {{
                        authStore.user?.name.replace(/\b\w/g, char => char.toUpperCase())
                        || 'Guest'
                    }}
                </div>

                <!-- Sync Button (mobile) -->
                <div v-if="authStore.isAuthenticated" class="px-2">
                    <BaseButton :isActive="syncStore.syncEnabled" @click="handleToggleSync" class="w-full space-x-1">
                        <RefreshCw class="w-4 h-4" />
                        <span>Sync</span>
                    </BaseButton>
                </div>

                <!-- About link -->
                <a href="https://github.com/kriscamilleri/pn-markdown-notes" target="_blank"
                    class="flex items-center space-x-2 mx-2">
                    <Info class="w-4 h-4" title="About" />
                    <span>About</span>
                </a>

                <!-- Login/Logout -->
                <div class="py-2">
                    <BaseButton v-if="!authStore.isAuthenticated" @click="goToLogin" class="w-full">
                        <LogIn class="w-4 h-4" title="Login" />
                        <span>Login</span>
                    </BaseButton>
                    <BaseButton v-else @click="handleLogout" class="w-full">
                        <LogOut class="w-4 h-4" title="Logout" />
                        <span>Logout</span>
                    </BaseButton>
                </div>
            </div>
        </div>
    </transition>
</template>

<script setup>
import { computed } from 'vue'
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'
import { useRouter } from 'vue-router'
import BaseButton from '@/components/BaseButton.vue'

import {
    RefreshCw,
    Info,
    LogIn,
    LogOut
} from 'lucide-vue-next'

const props = defineProps({
    isOpen: {
        type: Boolean,
        default: false
    }
})
const emit = defineEmits(['close'])

const authStore = useAuthStore()
const syncStore = useSyncStore()
const router = useRouter()

// We convert isOpen to a computed so we can do a small v-if check
const trueIsOpen = computed(() => props.isOpen)

function handleToggleSync() {
    syncStore.setSyncEnabled(!syncStore.syncEnabled)
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

<style scoped>
.fade-fast-enter-active,
.fade-fast-leave-active {
    transition: opacity 0.15s;
}

.fade-fast-enter-from,
.fade-fast-leave-to {
    opacity: 0;
}
</style>
<template>
    <div>
        <button
            v-if="layout === 'phone'"
            type="button"
            class="ph-row"
            :disabled="!syncStore.isOnline"
            data-testid="github-settings-open"
            @click="showBackup = true"
        >
            <Github
                class="h-5 w-5"
                aria-hidden="true"
            />
            <span class="ph-settings-grow">{{ syncStore.isOnline ? 'GitHub backup' : 'GitHub backup (needs a connection)' }}</span>
            <ChevronRight
                class="h-5 w-5"
                aria-hidden="true"
            />
        </button>
        <BaseButton
            v-else
            variant="secondary"
            size="md"
            :disabled="!syncStore.isOnline"
            :title="syncStore.isOnline ? '' : 'Needs an internet connection'"
            data-testid="github-settings-open"
            @click="showBackup = true"
        >
            <Github class="w-4 h-4" />
            <span>GitHub backup</span>
        </BaseButton>
        <GitHubBackupModal
            :show="showBackup"
            @close="showBackup = false"
        />
    </div>
</template>

<script setup>
/**
 * The GitHub backup card under the add-on's switch in Settings, desktop and
 * phone (manifest.js `settingsCard`). It owns a backup dialog of its own, and
 * finishes a GitHub connection: the server's OAuth return lands on
 * /settings?githubBackup=connected (or =error&message=…), so the card opens the
 * dialog, says how it went, and clears the query.
 */
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronRight, Github } from 'lucide-vue-next'
import BaseButton from '@/components/BaseButton.vue'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import GitHubBackupModal from './GitHubBackupModal.vue'

defineProps({
    layout: { type: String, default: 'desktop' },
})

const route = useRoute()
const router = useRouter()
const syncStore = useSyncStore()
const ui = useUiStore()
const showBackup = ref(false)

onMounted(async () => {
    const result = route.query.githubBackup
    if (!result) return

    showBackup.value = true
    if (result === 'connected') {
        ui.addToast('GitHub backup connected.', 'success')
    } else {
        ui.addToast(String(route.query.message || 'GitHub backup connection failed.'), 'error')
    }

    const nextQuery = { ...route.query }
    delete nextQuery.githubBackup
    delete nextQuery.message
    await router.replace({ query: nextQuery })
})
</script>

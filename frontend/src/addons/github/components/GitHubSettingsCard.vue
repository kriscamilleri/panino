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
 * /settings?addon=github&addonResult=pending&handle=… (or =error&addonMessage=…).
 * The card hands the handle back with this session's sign-in, which is what
 * ties the GitHub account to the person who started the connection, then
 * opens the dialog, says how it went, and clears the query.
 */
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronRight, Github } from 'lucide-vue-next'
import BaseButton from '@/components/BaseButton.vue'
import { withoutAddonReturn } from '@/composables/useAddonReturn'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { useGithubBackupStore } from '../store.js'
import GitHubBackupModal from './GitHubBackupModal.vue'

defineProps({
    layout: { type: String, default: 'desktop' },
})

const route = useRoute()
const router = useRouter()
const syncStore = useSyncStore()
const ui = useUiStore()
const store = useGithubBackupStore()
const showBackup = ref(false)

onMounted(async () => {
    if (route.query.addon !== 'github') return
    const { addonResult: result, addonMessage: message, handle } = route.query
    await router.replace({ query: withoutAddonReturn(route.query) })

    // Completed before the dialog opens, so the dialog's own status load sees the connection.
    if (result === 'pending' && typeof handle === 'string') {
        try {
            await store.completeConnect(handle)
            ui.addToast('GitHub backup connected.', 'success')
        } catch (err) {
            ui.addToast(err.message || 'GitHub backup connection failed.', 'error')
        }
    } else {
        ui.addToast(typeof message === 'string' && message ? message : 'GitHub backup connection failed.', 'error')
    }
    showBackup.value = true
})
</script>

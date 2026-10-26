<template>
    <PhoneShell>
        <div
            class="ph-settings"
            data-testid="phone-settings"
        >
            <header class="ph-settings-top">
                <button
                    type="button"
                    class="ph-icon-btn"
                    aria-label="Back"
                    data-testid="phone-settings-back"
                    @click="goBack"
                >
                    <ArrowLeft
                        class="h-6 w-6"
                        aria-hidden="true"
                    />
                </button>
                <h1 class="ph-display">Settings</h1>
            </header>

            <main class="ph-settings-scroll">
                <section
                    class="ph-settings-group"
                    aria-labelledby="ph-settings-account"
                >
                    <h2
                        id="ph-settings-account"
                        class="ph-section-label"
                    >Account</h2>
                    <div class="ph-card">
                        <div class="ph-settings-account">
                            <UserAvatar
                                :user="authStore.user || {}"
                                size="md"
                            />
                            <div class="ph-settings-account-text">
                                <p class="ph-settings-strong">{{ authStore.user?.name || 'Signed in' }}</p>
                                <p class="ph-muted">{{ authStore.user?.email }}</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            class="ph-row"
                            data-testid="phone-settings-account-details"
                            @click="router.push({ name: 'settings-account' })"
                        >
                            <UserCog
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                            <span class="ph-settings-grow">Account details and password</span>
                            <ChevronRight
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                        </button>
                        <button
                            type="button"
                            class="ph-row ph-row-danger"
                            data-testid="phone-settings-sign-out"
                            @click="signOut"
                        >
                            <LogOut
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                            Sign out
                        </button>
                    </div>
                </section>

                <section
                    class="ph-settings-group"
                    aria-labelledby="ph-settings-sync"
                >
                    <h2
                        id="ph-settings-sync"
                        class="ph-section-label"
                    >Sync</h2>
                    <div class="ph-card">
                        <div class="ph-settings-line">
                            <span
                                class="ph-sync-dot"
                                :data-state="sync.state"
                                aria-hidden="true"
                            ></span>
                            <div class="ph-settings-grow">
                                <p data-testid="phone-settings-sync-state">{{ sync.label }}</p>
                                <p
                                    v-if="sync.error"
                                    class="ph-muted"
                                >{{ sync.error }}</p>
                            </div>
                            <button
                                type="button"
                                class="ph-btn"
                                :disabled="!syncStore.isOnline || !syncStore.syncEnabled || syncStore.isSyncing"
                                data-testid="phone-settings-sync-now"
                                @click="syncNow"
                            >Sync now</button>
                        </div>
                        <div class="ph-settings-line">
                            <p
                                id="ph-settings-sync-switch"
                                class="ph-settings-grow"
                            >Sync this device</p>
                            <button
                                type="button"
                                role="switch"
                                class="ph-switch"
                                :aria-checked="syncStore.syncEnabled"
                                aria-labelledby="ph-settings-sync-switch"
                                data-testid="phone-settings-sync-switch"
                                @click="toggleSync"
                            ><span aria-hidden="true"></span></button>
                        </div>
                    </div>
                </section>

                <section
                    class="ph-settings-group"
                    aria-labelledby="ph-settings-notes"
                >
                    <h2
                        id="ph-settings-notes"
                        class="ph-section-label"
                    >Notes</h2>
                    <div class="ph-card ph-settings-choices">
                        <p class="ph-settings-strong">Home layout</p>
                        <SegmentedControl
                            :model-value="ui.homeLayout"
                            label="Home layout"
                            testid-prefix="phone-settings-layout"
                            :options="LAYOUT_OPTIONS"
                            @update:model-value="ui.setHomeLayout"
                        />
                        <p class="ph-settings-strong">Open notes in</p>
                        <SegmentedControl
                            :model-value="ui.openNotesIn"
                            label="Open notes in"
                            testid-prefix="phone-settings-open"
                            :options="OPEN_OPTIONS"
                            @update:model-value="ui.setOpenNotesIn"
                        />
                        <SortControls />
                    </div>
                </section>

                <section
                    class="ph-settings-group"
                    aria-labelledby="ph-settings-appearance"
                >
                    <h2
                        id="ph-settings-appearance"
                        class="ph-section-label"
                    >Appearance</h2>
                    <div class="ph-card ph-settings-choices">
                        <SegmentedControl
                            :model-value="themeStore.preference"
                            label="Appearance"
                            testid-prefix="phone-settings-appearance"
                            :options="APPEARANCE_OPTIONS"
                            @update:model-value="themeStore.setPreference"
                        />
                    </div>
                </section>

                <section
                    class="ph-settings-group"
                    aria-labelledby="ph-settings-tools"
                >
                    <h2
                        id="ph-settings-tools"
                        class="ph-section-label"
                    >Tools</h2>
                    <div class="ph-card">
                        <button
                            v-for="tool in tools"
                            :key="tool.key"
                            type="button"
                            class="ph-row"
                            :disabled="tool.disabled"
                            :data-testid="`phone-settings-tool-${tool.key}`"
                            @click="tool.run"
                        >
                            <component
                                :is="tool.icon"
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                            <span class="ph-settings-grow">{{ tool.label }}</span>
                        </button>
                    </div>
                </section>

                <section
                    class="ph-settings-group"
                    aria-labelledby="ph-settings-app"
                >
                    <h2
                        id="ph-settings-app"
                        class="ph-section-label"
                    >App</h2>
                    <div class="ph-card">
                        <button
                            v-if="!installed"
                            type="button"
                            class="ph-row"
                            :disabled="!canPrompt && !manualOnly"
                            data-testid="phone-settings-install"
                            @click="installApp"
                        >
                            <MonitorSmartphone
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                            <span class="ph-settings-grow">Add Panino to Home Screen</span>
                        </button>
                        <p
                            v-if="showManualInstall"
                            class="ph-muted ph-settings-hint"
                            data-testid="phone-settings-install-hint"
                        >In Safari, tap Share, then “Add to Home Screen”.</p>
                        <p
                            v-else-if="!installed && !canPrompt && !manualOnly"
                            class="ph-muted ph-settings-hint"
                        >Use your browser's menu to install Panino.</p>
                        <p
                            v-if="installed"
                            class="ph-settings-line"
                        >Installed on this device</p>
                        <a
                            class="ph-row"
                            href="https://github.com/kriscamilleri/pn-markdown-notes"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <Info
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                            <span class="ph-settings-grow">About Panino</span>
                            <span class="ph-muted">{{ appVersion }}</span>
                        </a>
                    </div>
                </section>
            </main>

            <ImportModal
                :show="ui.showImportModal"
                @close="ui.closeImportModal()"
                @import-success="handleImportSuccess"
            />
            <ExportModal
                :show="ui.showExportModal"
                @close="ui.closeExportModal()"
            />
            <GitHubBackupModal
                :show="ui.showGithubBackupModal"
                @close="ui.closeGithubBackupModal()"
            />
            <OdooConnectionModal
                :show="showOdoo"
                @close="showOdoo = false"
            />
            <VariablesModal
                :show="ui.showVariablesModal"
                @close="ui.closeVariablesModal()"
            />
        </div>
    </PhoneShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
    ArrowLeft, ChevronRight, LogOut, UserCog, Image, FileText, Users, Upload, Download,
    Github, Braces, MonitorSmartphone, Info, Monitor, Sun, Moon, Plug,
} from 'lucide-vue-next'
import PhoneShell from '@/components/phone/PhoneShell.vue'
import SegmentedControl from '@/components/phone/SegmentedControl.vue'
import SortControls from '@/components/phone/SortControls.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import ImportModal from '@/components/ImportModal.vue'
import ExportModal from '@/components/ExportModal.vue'
import GitHubBackupModal from '@/components/GitHubBackupModal.vue'
import OdooConnectionModal from '@/components/OdooConnectionModal.vue'
import VariablesModal from '@/components/VariablesModal.vue'
import { useAuthStore } from '@/store/authStore'
import { useDocStore } from '@/store/docStore'
import { useOdooStore } from '@/store/odooStore'
import { useSyncStore } from '@/store/syncStore'
import { useThemeStore } from '@/store/themeStore'
import { useUiStore } from '@/store/uiStore'
import { usePhoneStatus } from '@/composables/usePhoneStatus'
import { usePwaInstall } from '@/composables/usePwaInstall'
import { useSyncToggle } from '@/composables/useSyncToggle'

const LAYOUT_OPTIONS = [
    { value: 'grid', label: 'Grid' },
    { value: 'list', label: 'List' },
]
const OPEN_OPTIONS = [
    { value: 'auto', label: 'Automatic' },
    { value: 'preview', label: 'Preview' },
    { value: 'write', label: 'Edit' },
]
const APPEARANCE_OPTIONS = [
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
]

const router = useRouter()
const authStore = useAuthStore()
const docStore = useDocStore()
const syncStore = useSyncStore()
const themeStore = useThemeStore()
const ui = useUiStore()
const { sync, syncNow } = usePhoneStatus()
const { toggleSync } = useSyncToggle()
const { canPrompt, installed, manualOnly, install } = usePwaInstall()

const appVersion = import.meta.env.VITE_APP_VERSION || 'dev'
const showManualInstall = ref(false)
const odooStore = useOdooStore()
const showOdoo = ref(false)

const tools = computed(() => [
    { key: 'images', label: 'Images', icon: Image, disabled: !syncStore.isOnline, run: () => router.push('/images') },
    { key: 'templates', label: 'Templates', icon: FileText, run: () => router.push('/templates') },
    ...(syncStore.sharedSpacesAvailable
        ? [{ key: 'spaces', label: 'Shared spaces', icon: Users, run: () => router.push('/spaces') }]
        : []),
    { key: 'variables', label: 'Variables', icon: Braces, run: () => ui.openVariablesModal() },
    { key: 'import', label: 'Import', icon: Upload, run: () => ui.openImportModal() },
    { key: 'export', label: 'Export all', icon: Download, run: () => ui.openExportModal() },
    { key: 'backup', label: 'GitHub backup', icon: Github, run: () => ui.openGithubBackupModal() },
    ...(odooStore.available
        ? [{ key: 'odoo', label: 'Odoo', icon: Plug, disabled: !syncStore.isOnline, run: () => { showOdoo.value = true } }]
        : []),
])

onMounted(() => { void odooStore.fetchStatus() })

function goBack() {
    if (window.history.state?.back) router.back()
    else router.replace({ name: 'home' })
}

async function signOut() {
    try {
        await authStore.logout()
        router.push('/login')
    } catch (error) {
        console.error('[PhoneSettings] Sign out failed:', error)
        ui.addToast('Signing out failed. Try again.', 'error')
    }
}

async function installApp() {
    if (manualOnly.value) {
        showManualInstall.value = true
        return
    }
    await install()
}

function handleImportSuccess() {
    ui.addToast('Data imported successfully!', 'success')
    docStore.loadInitialData()
}
</script>

<style scoped>
.ph-settings {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--ph-canvas);
}

.ph-settings-top {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: calc(8px + env(safe-area-inset-top)) 8px 4px;
    flex-shrink: 0;
}

.ph-settings-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 16px 40px;
}

.ph-settings-group {
    margin-top: 18px;
}

.ph-settings-group .ph-section-label {
    padding: 0 4px 8px;
}

.ph-settings-group .ph-card {
    overflow: hidden;
}

.ph-settings-group .ph-card > * + * {
    border-top: 1px solid var(--ph-line);
}

.ph-settings-account,
.ph-settings-line {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    font-size: 15px;
}

.ph-settings-account-text {
    min-width: 0;
}

.ph-settings-account-text .ph-muted,
.ph-settings-line .ph-muted {
    font-size: 13px;
    overflow-wrap: anywhere;
}

.ph-settings-strong {
    font-weight: 600;
}

.ph-settings-grow {
    flex: 1;
    min-width: 0;
}

.ph-settings-choices {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
}

.ph-settings-group .ph-settings-choices > * + * {
    border-top: 0;
}

.ph-settings-hint {
    padding: 8px 20px 12px;
    font-size: 13px;
}

a.ph-row {
    text-decoration: none;
}

</style>

<template>
    <div
        v-if="show"
        class="fixed inset-0 z-50 flex items-center justify-center"
        data-testid="github-backup-modal-container"
    >
        <div
            class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
            @click="emit('close')"
        ></div>

        <div class="relative flex max-h-[80vh] w-[640px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div class="border-b px-6 py-4">
                <div class="flex items-center justify-between gap-4">
                    <div>
                        <h3 class="text-xl font-semibold text-gray-800">GitHub Backup</h3>
                    </div>
                    <button
                        class="text-gray-400 transition-colors hover:text-gray-600"
                        data-testid="github-backup-modal-close"
                        @click="emit('close')"
                    >
                        <X class="h-5 w-5" />
                    </button>
                </div>
            </div>

            <div class="flex-1 space-y-6 overflow-y-auto px-6 py-4">
                <p class="text-sm text-gray-600">
                    Push a full snapshot of your notes, folders, and images to a private GitHub repository.
                </p>

                <div
                    v-if="store.error"
                    class="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                    data-testid="github-backup-modal-store-error"
                >
                    {{ store.error }}
                </div>

                <section class="rounded-lg border border-gray-200 p-4">
                    <div class="flex items-center justify-between gap-4">
                        <div>
                            <h4 class="text-base font-semibold text-gray-800">Connection</h4>
                            <p class="mt-1 text-sm text-gray-600">
                                Authenticate with GitHub once. Panino stores the token on the backend and performs all backup API calls server-side.
                            </p>
                        </div>

                        <button
                            v-if="!store.status?.connected"
                            :disabled="!store.status?.oauthConfigured || store.isLoadingStatus"
                            class="inline-flex items-center gap-2 rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300"
                            data-testid="github-backup-connect-button"
                            @click="handleConnect"
                        >
                            <Github class="h-4 w-4" />
                            <span>Connect GitHub</span>
                        </button>

                        <button
                            v-else
                            :disabled="store.isDisconnecting || store.status?.isRunning"
                            class="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            data-testid="github-backup-disconnect-button"
                            @click="handleDisconnect"
                        >
                            <Unplug class="h-4 w-4" />
                            <span>{{ store.isDisconnecting ? 'Disconnecting...' : 'Disconnect' }}</span>
                        </button>
                    </div>

                    <div
                        v-if="!store.status?.oauthConfigured"
                        class="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                    >
                        GitHub OAuth is not configured on this server. Set <strong>GITHUB_CLIENT_ID</strong> and <strong>GITHUB_CLIENT_SECRET</strong> first.
                    </div>

                    <div
                        v-else-if="store.status?.connected"
                        class="mt-4 flex items-center gap-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3"
                        data-testid="github-backup-connected-state"
                    >
                        <img
                            v-if="store.status?.avatarUrl"
                            :src="store.status.avatarUrl"
                            alt="GitHub avatar"
                            class="h-12 w-12 rounded-full border border-emerald-200 object-cover"
                        />
                        <div>
                            <p class="text-sm font-medium text-emerald-900">Connected as {{ store.status.username }}</p>
                            <p class="text-sm text-emerald-700">
                                {{ store.status?.repoFullName ? 'Daily backups are enabled.' : 'Daily backups are enabled once a repository is selected.' }}
                            </p>
                        </div>
                    </div>
                </section>

                <section v-if="!store.selectedRepoFullName || isChangingRepo" class="rounded-lg border border-gray-200 p-4">
                    <div class="flex items-start justify-between gap-4">
                        <div>
                            <h4 class="text-base font-semibold text-gray-800">Repository</h4>
                            <p class="mt-1 text-sm text-gray-600">
                                Choose an existing repository with push access or create a new private one.
                            </p>
                        </div>
                        <div class="flex shrink-0 gap-2">
                            <button
                                v-if="isChangingRepo"
                                :disabled="!store.isConnected || store.isLoadingRepos"
                                class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                data-testid="github-backup-refresh-repos"
                                @click="refreshRepos"
                            >
                                {{ store.isLoadingRepos ? 'Refreshing...' : 'Refresh' }}
                            </button>
                        </div>
                    </div>

                    <!-- Repo picker -->
                    <div>
                        <div class="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                            <label class="block">
                                <span class="mb-2 block text-sm font-medium text-gray-700">Select repository</span>
                                <select
                                    v-model="selectedRepo"
                                    :disabled="!store.isConnected || store.isLoadingRepos || store.isSavingRepo"
                                    class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-1 focus:ring-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100"
                                    data-testid="github-backup-repo-select"
                                >
                                    <option value="">Choose a repository...</option>
                                    <option
                                        v-for="repo in store.repos"
                                        :key="repo.fullName"
                                        :value="repo.fullName"
                                    >
                                        {{ repo.fullName }}
                                    </option>
                                </select>
                            </label>

                            <button
                                :disabled="!selectedRepo || selectedRepo === store.selectedRepoFullName || store.isSavingRepo"
                                class="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300"
                                data-testid="github-backup-save-repo"
                                @click="handleSelectRepo"
                            >
                                {{ store.isSavingRepo ? 'Saving...' : 'Use Repository' }}
                            </button>
                        </div>

                        <div class="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4">
                            <p class="text-sm font-medium text-gray-800">Create a new private repository</p>
                            <div class="mt-3 flex flex-col gap-3 sm:flex-row">
                                <input
                                    v-model.trim="newRepoName"
                                    type="text"
                                    placeholder="panino-backup"
                                    :disabled="!store.isConnected || store.isCreatingRepo"
                                    class="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-1 focus:ring-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100"
                                    data-testid="github-backup-create-input"
                                />
                                <button
                                    :disabled="!newRepoName || !store.isConnected || store.isCreatingRepo"
                                    class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    data-testid="github-backup-create-button"
                                    @click="handleCreateRepo"
                                >
                                    {{ store.isCreatingRepo ? 'Creating...' : 'Create Private Repo' }}
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="rounded-lg border border-gray-200 p-4">
                    <div>
                        <h4 class="text-base font-semibold text-gray-800">Backup</h4>
                        <p class="mt-1 text-sm text-gray-600">
                            Create a full snapshot commit on <span class="font-medium text-gray-900">main</span>. Each backup preserves the repository's commit history.
                        </p>
                    </div>

                    <div
                        v-if="showProgressPanel"
                        class="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4"
                        data-testid="github-backup-progress"
                    >
                        <p class="text-sm font-medium text-gray-800">{{ currentStageLabel }}</p>
                        <div class="mt-3 grid gap-2 sm:grid-cols-4">
                            <div
                                v-for="step in progressSteps"
                                :key="step.key"
                                class="rounded-md border px-3 py-2 text-xs font-medium"
                                :class="step.stateClass"
                            >
                                {{ step.label }}
                            </div>
                        </div>
                    </div>

                    <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <div class="min-w-0 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                            <dt class="text-gray-500">Repository</dt>
                            <dd class="mt-1 truncate font-medium">
                                <a
                                    v-if="store.status?.repoFullName"
                                    :href="repoGithubUrl(store.status.repoFullName)"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    :title="store.status.repoFullName"
                                    class="text-blue-600 hover:underline"
                                >{{ store.status.repoFullName }}</a>
                                <span v-else class="text-gray-900">Not selected</span>
                            </dd>
                        </div>
                        <div class="min-w-0 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                            <dt class="text-gray-500">Next scheduled backup</dt>
                            <dd class="mt-1 font-medium text-gray-900">{{ formatDate(store.status?.nextScheduledAt) }}</dd>
                        </div>
                        <div class="min-w-0 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                            <dt class="text-gray-500">Last backup</dt>
                            <dd class="mt-1 font-medium text-gray-900">{{ formatDate(store.status?.lastBackupAt) }}</dd>
                        </div>
                        <div class="min-w-0 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                            <dt class="text-gray-500">Commit</dt>
                            <dd class="mt-1 truncate font-mono text-xs">
                                <a
                                    v-if="store.status?.lastBackupSha && store.status?.repoFullName"
                                    :href="commitGithubUrl(store.status.repoFullName, store.status.lastBackupSha)"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    :title="store.status.lastBackupSha"
                                    class="text-blue-600 hover:underline"
                                >{{ store.status.lastBackupSha.slice(0, 12) }}</a>
                                <span v-else class="text-gray-900">{{ store.status?.lastBackupSha || 'Unavailable' }}</span>
                            </dd>
                        </div>
                    </dl>

                    <div class="mt-4 flex items-center gap-3">
                        <button
                            :disabled="!canRunBackup"
                            class="inline-flex items-center gap-2 rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300"
                            data-testid="github-backup-run-button"
                            @click="handleRunBackup"
                        >
                            <CloudUpload class="h-4 w-4" />
                            <span>{{ store.status?.isRunning ? 'Backup Running...' : 'Back Up Now' }}</span>
                        </button>
                        <button
                            v-if="store.selectedRepoFullName"
                            :disabled="!store.isConnected || store.isLoadingRepos"
                            class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            data-testid="github-backup-change-repo"
                            @click="startChangingRepo"
                        >
                            Change Repository
                        </button>
                    </div>

                    <div
                        v-if="store.status?.lastWarning"
                        class="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                        data-testid="github-backup-last-warning"
                    >
                        Last backup completed with warnings: {{ store.status.lastWarning }}
                    </div>

                    <div
                        v-if="store.status?.lastError"
                        class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                        data-testid="github-backup-last-error"
                    >
                        Last backup failed: {{ store.status.lastError }}
                    </div>
                </section>
            </div>

            <div class="rounded-b-lg border-t bg-gray-50 px-6 py-4 text-right">
                <button
                    class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    @click="emit('close')"
                >
                    Close
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { CloudUpload, Github, Unplug, X } from 'lucide-vue-next';
import { useGithubBackupStore } from '@/store/githubBackupStore';
import { useUiStore } from '@/store/uiStore';
import {
    buildBackupProgressSteps,
    getBackupStageLabel,
    resolveVisibleBackupStage,
} from '@/utils/githubBackupProgress';

const props = defineProps({
    show: Boolean,
});

const emit = defineEmits(['close']);
const store = useGithubBackupStore();
const uiStore = useUiStore();
const { status } = storeToRefs(store);
const selectedRepo = ref('');
const newRepoName = ref('panino-backup');
const isChangingRepo = ref(false);
const retainedStage = ref(null);
const isShowingCompletion = ref(false);
let pollHandle = null;
let pollInFlight = false;
let progressHideHandle = null;

const POLL_INTERVAL_MS = 250;
const COMPLETION_LINGER_MS = 1800;

const canRunBackup = computed(() => {
    return Boolean(
        store.status?.connected &&
        store.status?.repoFullName &&
        !store.status?.isRunning &&
        !store.isStartingBackup
    );
});

const visibleStage = computed(() => resolveVisibleBackupStage({
    status: status.value,
    retainedStage: retainedStage.value,
    isShowingCompletion: isShowingCompletion.value,
}));

const showProgressPanel = computed(() => Boolean(visibleStage.value));

const currentStageLabel = computed(() => {
    return getBackupStageLabel(visibleStage.value || 'queued');
});

const progressSteps = computed(() => {
    return buildBackupProgressSteps(visibleStage.value || 'queued');
});

function formatDate(value) {
    if (!value) {
        return 'Not yet';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return 'Unknown';
    }

    return parsed.toLocaleString();
}

async function loadModalData() {
    try {
        const currentStatus = await store.fetchStatus();
        selectedRepo.value = currentStatus?.repoFullName || '';
        isChangingRepo.value = !currentStatus?.repoFullName;
        retainedStage.value = currentStatus?.isRunning ? (currentStatus.currentStage || 'queued') : null;
        isShowingCompletion.value = false;
        if (currentStatus?.connected) {
            await store.fetchRepos();
        }
        syncPolling(0);
    } catch {
        stopPolling();
    }
}

function repoGithubUrl(repoFullName) {
    if (!repoFullName) return null;
    return `https://github.com/${repoFullName}`;
}

function commitGithubUrl(repoFullName, sha) {
    if (!repoFullName || !sha) return null;
    return `https://github.com/${repoFullName}/commit/${sha}`;
}

function clearCompletionTimer() {
    if (progressHideHandle) {
        clearTimeout(progressHideHandle);
        progressHideHandle = null;
    }
}

function stopPolling() {
    if (pollHandle) {
        clearTimeout(pollHandle);
        pollHandle = null;
    }
}

function keepProgressVisible(stage) {
    clearCompletionTimer();
    retainedStage.value = stage || retainedStage.value || 'pushing_to_github';
    isShowingCompletion.value = true;
    progressHideHandle = setTimeout(() => {
        isShowingCompletion.value = false;
        if (!status.value?.isRunning) {
            retainedStage.value = null;
        }
        progressHideHandle = null;
    }, COMPLETION_LINGER_MS);
}

function syncPolling(delay = POLL_INTERVAL_MS) {
    if (!props.show || !status.value?.isRunning) {
        stopPolling();
        return;
    }

    if (!pollHandle) {
        pollHandle = setTimeout(async () => {
            pollHandle = null;

            if (pollInFlight) {
                syncPolling();
                return;
            }

            pollInFlight = true;
            try {
                const refreshedStatus = await store.fetchStatus();
                selectedRepo.value = refreshedStatus?.repoFullName || selectedRepo.value;
                if (refreshedStatus?.isRunning) {
                    retainedStage.value = refreshedStatus.currentStage || retainedStage.value || 'queued';
                    syncPolling();
                } else {
                    stopPolling();
                }
            } catch {
                stopPolling();
            } finally {
                pollInFlight = false;
            }
        }, delay);
    }
}

async function handleConnect() {
    try {
        const authorizeUrl = await store.startConnect();
        if (authorizeUrl) {
            window.location.assign(authorizeUrl);
        }
    } catch (err) {
        uiStore.addToast(err.message || 'Failed to start GitHub OAuth', 'error');
    }
}

async function handleDisconnect() {
    try {
        await store.disconnect();
        selectedRepo.value = '';
        uiStore.addToast('GitHub backup disconnected.', 'success');
    } catch (err) {
        uiStore.addToast(err.message || 'Failed to disconnect GitHub backup', 'error');
    }
}

async function refreshRepos() {
    try {
        await store.fetchRepos();
        uiStore.addToast('GitHub repositories refreshed.', 'success');
    } catch (err) {
        uiStore.addToast(err.message || 'Failed to refresh repositories', 'error');
    }
}

async function handleSelectRepo() {
    try {
        await store.selectRepo(selectedRepo.value);
        isChangingRepo.value = false;
        uiStore.addToast('Backup repository updated.', 'success');
    } catch (err) {
        uiStore.addToast(err.message || 'Failed to save repository selection', 'error');
    }
}

async function handleCreateRepo() {
    try {
        const repo = await store.createRepo(newRepoName.value);
        selectedRepo.value = repo?.fullName || selectedRepo.value;
        isChangingRepo.value = false;
        uiStore.addToast('Private GitHub repository created.', 'success');
    } catch (err) {
        uiStore.addToast(err.message || 'Failed to create repository', 'error');
    }
}

function startChangingRepo() {
    selectedRepo.value = '';
    isChangingRepo.value = true;
}

async function handleRunBackup() {
    try {
        await store.runBackup();
        retainedStage.value = status.value?.currentStage || 'queued';
        isShowingCompletion.value = false;
        clearCompletionTimer();
        syncPolling(0);
        uiStore.addToast('GitHub backup started.', 'info');
    } catch (err) {
        uiStore.addToast(err.message || 'Failed to start backup', 'error');
    }
}

watch(() => props.show, (isOpen) => {
    if (isOpen) {
        loadModalData();
    } else {
        stopPolling();
        clearCompletionTimer();
        isShowingCompletion.value = false;
        retainedStage.value = null;
    }
}, { immediate: true });

watch(() => status.value?.currentStage, (stage) => {
    if (stage) {
        retainedStage.value = stage;
    }
});

watch(() => status.value?.isRunning, (isRunning, wasRunning) => {
    if (isRunning) {
        isShowingCompletion.value = false;
        clearCompletionTimer();
        syncPolling(0);
        return;
    }

    stopPolling();
    if (wasRunning) {
        keepProgressVisible(retainedStage.value || 'pushing_to_github');
    }
});

onBeforeUnmount(() => {
    stopPolling();
    clearCompletionTimer();
});
</script>
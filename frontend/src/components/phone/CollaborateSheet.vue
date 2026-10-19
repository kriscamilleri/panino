<template>
    <BottomSheet
        :open="open && Boolean(file)"
        label="Collaborate"
        testid="phone-collaborate-sheet"
        @close="$emit('close')"
    >
        <template #header>
            <div class="ph-collab-head">
                <h2 class="ph-collab-title">Collaborate</h2>
                <p class="ph-muted">{{ file?.title || 'Untitled' }}</p>
            </div>
        </template>

        <!-- A personal Document is shared by moving it into a space. -->
        <div
            v-if="!spaceId"
            class="ph-collab-section"
            data-testid="phone-collab-personal"
        >
            <p>This Document is private to you. To work on it with others, it has to live in a shared space.</p>
            <p class="ph-muted ph-collab-note">Copy or move it into a space from Panino on a computer. Spaces you share appear under Shared.</p>
            <button
                v-if="syncStore.sharedSpacesAvailable"
                type="button"
                class="ph-btn"
                @click="closeSheetAndGo({ name: 'spaces' })"
            >Manage spaces</button>
        </div>

        <template v-else>
            <div class="ph-collab-section ph-collab-live">
                <div class="ph-collab-live-text">
                    <p
                        id="ph-collab-live-label"
                        class="ph-collab-live-label"
                    >Live editing</p>
                    <p
                        class="ph-muted"
                        data-testid="phone-collab-live-hint"
                    >{{ liveHint }}</p>
                </div>
                <button
                    type="button"
                    role="switch"
                    class="ph-switch"
                    :aria-checked="isLive"
                    aria-labelledby="ph-collab-live-label"
                    :disabled="!canToggleLive"
                    data-testid="phone-collab-live"
                    @click="toggleLive"
                >
                    <span aria-hidden="true"></span>
                </button>
            </div>
            <div
                v-if="isLive"
                class="ph-collab-section ph-collab-row"
            >
                <p class="ph-muted">{{ collabStore.unackedCount }} unsaved {{ collabStore.unackedCount === 1 ? 'change' : 'changes' }}</p>
                <button
                    type="button"
                    class="ph-btn"
                    :disabled="collabStore.status !== 'live' || collabStore.unackedCount > 0"
                    data-testid="phone-collab-save-version"
                    @click="saveVersion"
                >Save version</button>
            </div>

            <form
                v-if="isOwner"
                class="ph-collab-section ph-collab-invite"
                @submit.prevent="sendInvite"
            >
                <label
                    class="ph-section-label"
                    for="ph-collab-email"
                >Invite by email</label>
                <div class="ph-collab-row">
                    <input
                        id="ph-collab-email"
                        v-model="inviteEmail"
                        class="ph-input"
                        type="email"
                        autocomplete="off"
                        inputmode="email"
                        placeholder="name@example.com"
                        data-testid="phone-collab-email"
                    >
                    <button
                        type="submit"
                        class="ph-btn ph-btn-primary"
                        :disabled="!inviteEmail.trim() || inviting || !syncStore.isOnline"
                        data-testid="phone-collab-invite"
                    >{{ inviting ? 'Sending…' : 'Invite' }}</button>
                </div>
                <p class="ph-muted ph-collab-note">Invited people can edit everything in {{ spaceName }}.</p>
            </form>

            <div class="ph-collab-section">
                <p class="ph-section-label">People with access</p>
                <p
                    v-if="loadingPeople"
                    class="ph-muted"
                >Loading…</p>
                <p
                    v-else-if="peopleError"
                    class="ph-muted"
                >{{ peopleError }}</p>
                <ul
                    v-else
                    class="ph-collab-people"
                    data-testid="phone-collab-people"
                >
                    <li
                        v-for="person in people"
                        :key="person.id"
                        class="ph-collab-person"
                    >
                        <UserAvatar
                            :user="person"
                            size="md"
                        />
                        <div class="ph-collab-person-text">
                            <p>{{ person.name || 'Member' }}<span v-if="person.id === authStore.user?.id"> (you)</span></p>
                            <p class="ph-muted">
                                {{ person.role === 'owner' ? 'Owner' : 'Can edit' }}<template v-if="editingIds.has(person.id)"> · <span class="ph-collab-now">Editing now</span></template>
                            </p>
                        </div>
                    </li>
                </ul>
            </div>

            <div class="ph-collab-section ph-collab-notice">
                <Info
                    class="h-5 w-5"
                    aria-hidden="true"
                />
                <p>This Document is in {{ spaceName }}, so everyone in that space can edit it. Access is set for the whole space.</p>
            </div>

            <div class="ph-collab-section">
                <button
                    type="button"
                    class="ph-btn ph-collab-copy"
                    data-testid="phone-collab-copy-link"
                    @click="copyLink"
                >
                    <Link
                        class="h-5 w-5"
                        aria-hidden="true"
                    />
                    Copy link
                </button>
                <p class="ph-muted ph-collab-note">The link opens this Document for people already in {{ spaceName }}.</p>
            </div>
        </template>
    </BottomSheet>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Info, Link } from 'lucide-vue-next'
import BottomSheet from '@/components/phone/BottomSheet.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { useAuthStore } from '@/store/authStore'
import { useCollabSessionStore } from '@/store/collabSessionStore'
import { useDocStore } from '@/store/docStore'
import { useEditorStore } from '@/store/editorStore'
import { useSpacesStore } from '@/store/spacesStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { useSheetRoute } from '@/composables/useSheetRoute'
import { parseDatabaseKey } from '@/utils/databaseKey'

const props = defineProps({
    open: { type: Boolean, default: false },
})
defineEmits(['close'])

const authStore = useAuthStore()
const collabStore = useCollabSessionStore()
const docStore = useDocStore()
const editorStore = useEditorStore()
const spacesStore = useSpacesStore()
const syncStore = useSyncStore()
const ui = useUiStore()
const { closeSheetAndGo } = useSheetRoute()
const { selectedFile: file } = storeToRefs(docStore)

const people = ref([])
const loadingPeople = ref(false)
const peopleError = ref('')
const inviteEmail = ref('')
const inviting = ref(false)

const spaceId = computed(() => {
    const dbKey = file.value?.dbKey
    return dbKey?.startsWith('space:') ? parseDatabaseKey(dbKey).id : null
})
const entry = computed(() => (file.value ? syncStore.databases.get(file.value.dbKey) : null))
const spaceName = computed(() => entry.value?.name || 'this space')
const isOwner = computed(() => entry.value?.role === 'owner')
const isLive = computed(() => collabStore.isActive && collabStore.noteId === file.value?.id)
const canToggleLive = computed(() => isLive.value || (syncStore.liveSessionsAvailable && syncStore.isOnline))
const editingIds = computed(() => new Set(isLive.value ? collabStore.participants.map((participant) => participant.id) : []))

const liveHint = computed(() => {
    if (!syncStore.liveSessionsAvailable) return 'Live editing is not available on this server.'
    if (!syncStore.isOnline && !isLive.value) return 'Live editing needs a connection.'
    if (isLive.value) {
        const count = collabStore.participants.length
        return `Live · ${count} editing. Everyone sees changes as they are typed.`
    }
    return 'Edit together and see each other’s changes as they are typed.'
})

watch(() => [props.open, spaceId.value], async ([open, id]) => {
    if (!open || !id) return
    loadingPeople.value = true
    peopleError.value = ''
    try {
        const detail = await spacesStore.loadDetail(id)
        people.value = detail?.members || []
    } catch (error) {
        // Offline or refused: fall back to the names the registry already has.
        people.value = entry.value?.members || []
        peopleError.value = people.value.length ? '' : 'People could not be loaded.'
    } finally {
        loadingPeople.value = false
    }
}, { immediate: true })

async function toggleLive() {
    if (isLive.value) editorStore.leaveCollaboration()
    else await editorStore.startCollaboration()
}

function saveVersion() {
    editorStore.requestSaveVersion()
}

async function sendInvite() {
    const email = inviteEmail.value.trim()
    if (!email || !spaceId.value) return
    inviting.value = true
    try {
        await spacesStore.invite(spaceId.value, email)
        if (spacesStore.detail?.members) people.value = spacesStore.detail.members
        inviteEmail.value = ''
        ui.addToast(`Invitation sent to ${email}.`, 'success', 3000)
    } catch (error) {
        ui.addToast(error.message || 'The invitation could not be sent.', 'error')
    } finally {
        inviting.value = false
    }
}

async function copyLink() {
    const target = file.value
    if (!target) return
    const url = `${window.location.origin}${window.location.pathname}#/doc/${encodeURIComponent(target.id)}?dbKey=${encodeURIComponent(target.dbKey)}`
    try {
        await navigator.clipboard.writeText(url)
        ui.addToast('Link copied.', 'success', 2500)
    } catch {
        ui.addToast('The link could not be copied.', 'error')
    }
}
</script>

<style scoped>
.ph-collab-head {
    padding: 0 8px;
}

.ph-collab-title {
    font-family: var(--ph-serif);
    font-size: 24px;
    font-weight: 700;
}

.ph-collab-section {
    padding: 12px 20px;
    font-size: 15px;
    line-height: 1.45;
}

.ph-collab-section + .ph-collab-section {
    border-top: 1px solid var(--ph-line);
}

.ph-collab-section .ph-btn {
    margin-top: 10px;
}

.ph-collab-note {
    margin-top: 6px;
    font-size: 13px;
}

.ph-collab-live,
.ph-collab-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.ph-collab-row .ph-btn {
    margin-top: 0;
}

.ph-collab-row .ph-input {
    flex: 1;
}

.ph-collab-live-text {
    flex: 1;
    min-width: 0;
}

.ph-collab-live-label {
    font-weight: 600;
}

.ph-collab-live-text .ph-muted,
.ph-collab-row .ph-muted {
    font-size: 13px;
}

.ph-collab-row > .ph-muted {
    flex: 1;
}

.ph-collab-invite .ph-section-label {
    display: block;
    margin-bottom: 8px;
}

.ph-collab-people {
    margin-top: 8px;
}

.ph-collab-person {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 0;
}

.ph-collab-person-text {
    min-width: 0;
}

.ph-collab-person-text .ph-muted {
    font-size: 13px;
}

.ph-collab-now {
    color: var(--ph-ok);
    font-weight: 600;
}

.ph-collab-notice {
    display: flex;
    gap: 10px;
    margin: 0 16px;
    border-radius: 14px;
    background: var(--ph-accent-soft);
}

.ph-collab-section.ph-collab-notice {
    border-top: 0;
}

.ph-collab-notice svg {
    flex-shrink: 0;
    margin-top: 2px;
}

.ph-collab-copy {
    width: 100%;
}

</style>

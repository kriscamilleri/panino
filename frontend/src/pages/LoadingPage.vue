<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div v-if="!syncFailed" class="text-center" data-testid="loading-page-loading">
      <div class="mb-4">
        <svg class="animate-spin h-8 w-8 text-gray-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none"
          viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4zm2 5.29A7.95 7.95 0 014 12H0c0 3.04 1.14 5.82 3 7.94l3-2.65z" />
        </svg>
      </div>
      <p class="text-gray-700">Setting up your data environment...</p>
      <p class="text-sm text-gray-500 mt-2" data-testid="loading-page-status">{{ statusMessage }}</p>
    </div>

    <!-- If remote sync fails, we show a fallback message -->
    <div v-else class="text-center max-w-md bg-white p-6 rounded shadow-md" data-testid="loading-page-failed">
      <h2 class="text-lg font-semibold text-red-600 mb-2">Offline Mode</h2>
      <p class="mb-4 text-gray-600">
        We couldn't reach the remote database. You're now in local/offline mode. Your changes will not be synced.
      </p>
      <button @click="goHome" class="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900"
        data-testid="loading-page-continue-button">
        Continue
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDocStore } from '@/store/docStore'
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'

const docStore = useDocStore()
const authStore = useAuthStore()
const syncStore = useSyncStore()
const router = useRouter()
const syncFailed = ref(false)
const statusMessage = ref('Initializing database...')

onMounted(async () => {
  try {
    statusMessage.value = 'Initializing database...'
    await syncStore.initializeDB() // Use syncStore directly for init

    // If user is authenticated and not a guest, attempt a one-time sync
    if (authStore.isAuthenticated && authStore.user?.name !== 'guest') {
      statusMessage.value = 'Attempting initial sync...'
      try {
        await syncStore.oneTimePull() // Use syncStore directly
        // If pull succeeds, load sync preference (which might enable live sync)
        // syncStore.loadSyncPreference(); // Handled by initializeDB/auth watcher now
      } catch (pullError) {
        console.warn('Initial sync failed, proceeding in offline mode initially.', pullError)
        // Don't set syncFailed yet, allow loading structure
        // User can manually enable sync later if they want.
        syncStore.setSyncEnabled(false) // Ensure sync is off if pull fails
      }
    } else {
      // Guests always start with sync disabled
      syncStore.setSyncEnabled(false);
    }

    statusMessage.value = 'Loading document structure...'
    await docStore.structureStore.loadStructure() // Load structure via docStore

    // If we get here, the local setup is complete enough to proceed
    statusMessage.value = 'Setup complete!'
    router.replace('/')

  } catch (error) {
    console.error('Critical database initialization or structure loading failed:', error)
    // If *initialization* or *structure load* fails critically, show the failure state
    syncFailed.value = true
    statusMessage.value = `Error: ${error.message}`
  }
})

function goHome() {
  // If user wants to continue in offline mode after a failure
  router.replace('/')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div v-if="!initializationFailed" class="text-center" data-testid="loading-page-loading">
      <div class="mb-4">
        <svg class="animate-spin h-8 w-8 text-gray-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none"
          viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4zm2 5.29A7.95 7.95 0 014 12H0c0 3.04 1.14 5.82 3 7.94l3-2.65z" />
        </svg>
      </div>
      <p class="text-gray-700">Setting up your local-first environment...</p>
      <p class="text-sm text-gray-500 mt-2" data-testid="loading-page-status">{{ statusMessage }}</p>
    </div>

    <div v-else class="text-center max-w-md bg-white p-6 rounded shadow-md" data-testid="loading-page-failed">
      <h2 class="text-lg font-semibold text-red-600 mb-2">Initialization Failed</h2>
      <p class="mb-4 text-gray-600">
        We couldn't set up the local database. This might be due to an unsupported browser or a critical error.
      </p>
      <pre class="text-xs text-left bg-gray-100 p-2 rounded overflow-auto mb-4">{{ errorMessage }}</pre>
      <button @click="retryInitialization" class="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900"
        data-testid="loading-page-retry-button">
        Retry
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useSyncStore } from '@/store/syncStore';
import { useDocStore } from '@/store/docStore';

const syncStore = useSyncStore();
const docStore = useDocStore();
const router = useRouter();

const statusMessage = ref('Initializing local database...');
const initializationFailed = ref(false);
const errorMessage = ref('');

async function initialize() {
  initializationFailed.value = false;
  errorMessage.value = '';
  try {
    statusMessage.value = 'Initializing local database...';
    await syncStore.initializeDB();

    // ✅ FIX: Perform the first sync to pull data from the server.
    statusMessage.value = 'Syncing with server...';
    await syncStore.sync();

    statusMessage.value = 'Loading data...';
    await docStore.loadInitialData();

    statusMessage.value = 'Setup complete!';
    router.replace('/');
  } catch (error) {
    console.error('Critical initialization failed:', error);
    initializationFailed.value = true;
    errorMessage.value = error.message;
    statusMessage.value = 'Error during setup.';
  }
}

function retryInitialization() {
  window.location.reload();
}

onMounted(initialize);
</script>
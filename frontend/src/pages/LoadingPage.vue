<template>
    <div class="min-h-screen flex items-center justify-center bg-gray-50">
      <div v-if="!syncFailed" class="text-center">
        <div class="mb-4">
          <svg
            class="animate-spin h-8 w-8 text-gray-600 mx-auto"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            />
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4zm2 5.29A7.95 7.95 0 014 12H0c0 3.04 1.14 5.82 3 7.94l3-2.65z"
            />
          </svg>
        </div>
        <p class="text-gray-700">Attempting to sync your data from remote server...</p>
      </div>
  
      <!-- If remote sync fails, we show a fallback message -->
      <div v-else class="text-center max-w-md bg-white p-6 rounded shadow-md">
        <h2 class="text-lg font-semibold text-red-600 mb-2">Offline Mode</h2>
        <p class="mb-4 text-gray-600">
          We couldn’t reach the remote database. You’re now in local/offline mode
          with only the default “welcome” doc available.
        </p>
        <button
          @click="goHome"
          class="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900"
        >
          Continue
        </button>
      </div>
    </div>
  </template>
  
  <script setup>
  import { ref, onMounted } from 'vue'
  import { useRouter } from 'vue-router'
  import { useDocStore } from '@/store/docStore'
  
  const docStore = useDocStore()
  const router = useRouter()
  const syncFailed = ref(false)


  onMounted(async () => {
    try {
        console.log('Attempting to sync data from remote server...')
      await docStore.initCouchDB()
      // If we get here, the remote is reachable and we have done a full one-time pull
      router.replace('/')
    } catch (error) {
      console.error('Remote sync attempt failed:', error)
      // Show fallback offline mode
      syncFailed.value = true
    }
  })
  
  function goHome() {
    // If user wants to continue in offline mode
    router.replace('/')
  }
  </script>
  
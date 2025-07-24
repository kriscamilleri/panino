// /frontend/src/store/syncStore.js
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { PowerSyncDatabase } from '@powersync/web';
import { AppSchema } from '@/utils/appSchema.js';
import { useAuthStore } from './authStore';

export const useSyncStore = defineStore('syncStore', () => {
  const powerSync = ref(null);
  const isInitialized = ref(false);
  const syncEnabled = ref(true);

  const getAuthStore = () => useAuthStore();

  async function initializeDB() {
    console.log('Starting PowerSync initialization...');

    if (powerSync.value) {
      console.log('Cleaning up existing PowerSync instance...');
      try {
        await powerSync.value.disconnectAndClear();
      } catch (error) {
        console.warn('Error during cleanup:', error);
      }
      powerSync.value = null;
      isInitialized.value = false;
    }

    try {
      console.log('Creating PowerSync database instance...');

      // Modern PowerSync initialization syntax
      const db = new PowerSyncDatabase({
        database: {
          dbFilename: 'panino.db'
        },
        schema: AppSchema
      });

      console.log('Initializing PowerSync database...');
      // Initialize the database
      await db.init();

      powerSync.value = db;
      isInitialized.value = true;
      console.log('✅ PowerSync local database initialized successfully.');

      // Try to handle connection state
      await handleConnectionState();
    } catch (error) {
      console.error('❌ Failed to initialize PowerSync database:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });

      // Set flags to indicate failure but don't throw
      // This allows the app to continue in a degraded state
      powerSync.value = null;
      isInitialized.value = false;

      throw new Error(`PowerSync initialization failed: ${error.message}`);
    }
  }

  async function handleConnectionState() {
    if (!powerSync.value) {
      console.warn('Cannot handle connection state, PowerSync not initialized.');
      return;
    }

    const authStore = getAuthStore();
    if (authStore.isAuthenticated && syncEnabled.value) {
      console.log('User is authenticated, connecting to PowerSync service...');
      try {
        await powerSync.value.connect({
          endpoint: import.meta.env.VITE_POWERSYNC_URL,
          token: authStore.powersyncToken
        });
        console.log('Successfully connected to PowerSync.');
      } catch (error) {
        console.error('Failed to connect to PowerSync:', error);
        // Don't throw here - allow offline usage
      }
    } else {
      console.log('User is not authenticated or sync disabled, disconnecting from PowerSync service.');
      try {
        await powerSync.value.disconnect();
      } catch (error) {
        console.error('Error disconnecting from PowerSync:', error);
      }
    }
  }

  function setSyncEnabled(enabled) {
    syncEnabled.value = enabled;
    if (isInitialized.value) {
      handleConnectionState();
    }
  }

  async function execute(sql, args = []) {
    if (!powerSync.value) throw new Error('PowerSync not initialized');
    return await powerSync.value.execute(sql, args);
  }

  async function resetDatabase() {
    if (powerSync.value) {
      await powerSync.value.disconnectAndClear();
    }
    powerSync.value = null;
    isInitialized.value = false;

    // Clear IndexedDB database
    try {
      const deleteReq = window.indexedDB.deleteDatabase('panino.db');
      await new Promise((resolve, reject) => {
        deleteReq.onsuccess = () => {
          console.log("Database cleared successfully");
          resolve();
        };
        deleteReq.onerror = (e) => {
          console.error("Error clearing database", e);
          reject(e);
        };
      });
    } catch (error) {
      console.error("Failed to clear database:", error);
    }

    // Reinitialize
    await initializeDB();
  }

  return {
    powerSync,
    isInitialized,
    syncEnabled,
    initializeDB,
    execute,
    handleConnectionState,
    setSyncEnabled,
    resetDatabase
  };
});
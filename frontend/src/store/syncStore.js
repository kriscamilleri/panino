// /frontend/src/store/syncStore.js
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { PowerSyncDatabase } from '@journeyapps/powersync-sdk-web';
import { WASQLitePowerSyncDatabaseOpenFactory } from '@journeyapps/powersync-sdk-web';
import { useAuthStore } from './authStore';

// Define the schema for the local SQLite database.
const AppSchema = {
  version: 1,
  tables: [
    {
      name: 'users',
      columns: [
        { name: 'email', type: 'TEXT' },
        { name: 'created_at', type: 'TEXT' }
      ]
    },
    {
      name: 'folders',
      columns: [
        { name: 'user_id', type: 'TEXT' },
        { name: 'name', type: 'TEXT' },
        { name: 'parent_id', type: 'TEXT' },
        { name: 'created_at', type: 'TEXT' }
      ]
    },
    {
      name: 'notes',
      columns: [
        { name: 'user_id', type: 'TEXT' },
        { name: 'folder_id', type: 'TEXT' },
        { name: 'title', type: 'TEXT' },
        { name: 'content', type: 'TEXT' },
        { name: 'created_at', type: 'TEXT' },
        { name: 'updated_at', type: 'TEXT' }
      ]
    },
    {
      name: 'images',
      columns: [
        { name: 'user_id', type: 'TEXT' },
        { name: 'filename', type: 'TEXT' },
        { name: 'mime_type', type: 'TEXT' },
        { name: 'data', type: 'BLOB' },
        { name: 'created_at', type: 'TEXT' }
      ]
    },
    {
      name: 'settings', // For local-only UI/Markdown settings
      columns: [
        { name: 'key', type: 'TEXT', primaryKey: true },
        { name: 'value', type: 'TEXT' }
      ],
      localOnly: true
    }
  ]
};

export const useSyncStore = defineStore('syncStore', () => {
  const powerSync = ref(null);
  const isInitialized = ref(false);

  const getAuthStore = () => useAuthStore();

  async function initializeDB() {
    if (powerSync.value) {
      await powerSync.value.disconnectAndClose();
      powerSync.value = null;
    }
    const db = new PowerSyncDatabase({
      database: { dbName: 'panino.db' },
      schema: AppSchema,
      factory: WASQLitePowerSyncDatabaseOpenFactory
    });

    powerSync.value = db;
    isInitialized.value = true;
    console.log('PowerSync local database initialized.');

    handleConnectionState();
  }

  async function handleConnectionState() {
    if (!powerSync.value) {
      console.warn('Cannot handle connection state, PowerSync not initialized.');
      return;
    }
    const authStore = getAuthStore();
    if (authStore.isAuthenticated) {
      console.log('User is authenticated, connecting to PowerSync service...');
      try {
        await powerSync.value.connect({
          endpoint: import.meta.env.VITE_POWERSYNC_URL,
          token: authStore.powersyncToken
        });
        console.log('Successfully connected to PowerSync.');
      } catch (error) {
        console.error('Failed to connect to PowerSync:', error);
      }
    } else {
      console.log('User is not authenticated, disconnecting from PowerSync service.');
      await powerSync.value.disconnect();
    }
  }

  async function execute(sql, args = []) {
    if (!powerSync.value) throw new Error('PowerSync not initialized');
    return await powerSync.value.execute(sql, args);
  }

  async function resetDatabase() {
    if (powerSync.value) {
      await powerSync.value.disconnectAndClose();
    }
    powerSync.value = null;
    isInitialized.value = false;
    const dbRequest = window.indexedDB.deleteDatabase('panino.db');
    dbRequest.onsuccess = () => console.log("Database cleared successfully");
    dbRequest.onerror = (e) => console.error("Error clearing database", e);
    await initializeDB();
  }

  return {
    powerSync,
    isInitialized,
    initializeDB,
    execute,
    handleConnectionState,
    resetDatabase
  };
});
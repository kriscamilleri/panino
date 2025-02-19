// src/store/syncStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'
import PouchDB from 'pouchdb-browser'
import { useAuthStore } from './authStore'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost'
const COUCHDB_PORT = import.meta.env.VITE_COUCHDB_PORT || '5984'
const COUCHDB_URL = `${API_BASE_URL}:${COUCHDB_PORT}`

const WELCOME_CONTENT = {
  _id: 'file:welcome',
  type: 'content',
  text: '# Welcome to Markdown Editor\n\nStart by importing your data or creating new files.',
  properties: '\n',
  discussions: {},
  comments: {},
  hash: Date.now(),
  tx: Date.now()
}

export const useSyncStore = defineStore('syncStore', () => {
  let localDB = null
  let syncHandler = null
  const isInitialized = ref(false)

  const authStore = useAuthStore()

  // ADD THIS:
  const syncEnabled = ref(false)

  // Turn syncing on or off
  function setSyncEnabled(enable) {
    if (enable) {
      // Start live sync only if the user is authenticated and not a guest
      if (!authStore.isAuthenticated || authStore.user?.name === 'guest') {
        console.log('Skipping live sync; user is guest or not authenticated.')
        syncEnabled.value = false
        return
      }

      console.log('Enabling live sync...')
      startLiveSync() // your existing method
      syncEnabled.value = true
    } else {
      console.log('Disabling live sync...')
      if (syncHandler) {
        syncHandler.cancel()
        syncHandler = null
      }
      syncEnabled.value = false
    }
  }

  async function initializeDB() {
    if (syncHandler) {
      syncHandler.cancel()
      syncHandler = null
    }
    if (localDB) {
      await localDB.close()
      localDB = null
    }

    const dbName = authStore.isAuthenticated
      ? `pn-markdown-notes-${authStore.user.name.toLowerCase()}`
      : 'pn-markdown-notes-guest'

    localDB = new PouchDB(dbName, {
      auto_compaction: true
    })

    authStore.registerDatabase(dbName)

    // Ensure we have a docStoreData doc
    try {
      await localDB.get('docStoreData')
    } catch (err) {
      if (err.status === 404) {
        await localDB.put({
          _id: 'docStoreData',
          structure: {
            welcome: {
              id: 'welcome',
              type: 'file',
              name: 'Welcome.md',
              parentId: null,
              hash: Date.now(),
              tx: Date.now()
            }
          },
          lastModified: new Date().toISOString()
        })
        await localDB.put(WELCOME_CONTENT)
      } else {
        throw err
      }
    }

    isInitialized.value = true
    console.log(`[initializeDB] Local DB "${dbName}" is set up.`)
  }

  /**
   * Perform a one-time pull from remote to local to test connectivity.
   * Skip if the user is 'guest' or not authenticated.
   */
  async function oneTimePull() {
    if (!authStore.isAuthenticated || authStore.user?.name === 'guest') {
      console.log('Skipping remote sync in guest mode or when not authenticated.')
      return
    }
    if (!isInitialized.value || !localDB) {
      throw new Error('Local DB not initialized before one-time pull.')
    }

    const remoteCouch = `${COUCHDB_URL}/pn-markdown-notes-${authStore.user.name.toLowerCase()}`

    console.log('[oneTimePull] Trying single pull replication from remote:', remoteCouch)
    const result = await localDB.replicate.from(remoteCouch, {
      live: false,
      retry: false,
      timeout: 10000,
      fetch: (url, opts) => {
        return fetch(url, {
          ...opts,
          credentials: 'include'
        })
      }
    })
    console.log('[oneTimePull] Completed single pull. Result:', result)
  }

  /**
   * Start a continuous live sync in the background, unless it's guest mode.
   */
  function startLiveSync() {
    if (!authStore.isAuthenticated || authStore.user?.name === 'guest') {
      console.log('Skipping live sync in guest mode or when not authenticated.')
      return
    }
    if (!isInitialized.value || !localDB) {
      throw new Error('Cannot start live sync before DB init.')
    }

    const remoteCouch = `${COUCHDB_URL}/pn-markdown-notes-${authStore.user.name.toLowerCase()}`

    syncHandler = localDB.sync(remoteCouch, {
      live: true,
      retry: true,
      batch_size: 10,
      fetch: (url, opts) => {
        return fetch(url, {
          ...opts,
          credentials: 'include'
        })
      }
    })
      .on('change', (info) => {
        console.log('[liveSync] change:', info)
      })
      .on('paused', (err) => {
        if (err) {
          console.error('[liveSync] paused with error:', err)
        } else {
          console.log('[liveSync] paused (caught up)')
        }
      })
      .on('active', () => {
        console.log('[liveSync] active')
      })
      .on('denied', (err) => {
        console.error('[liveSync] denied:', err)
      })
      .on('error', (err) => {
        console.error('[liveSync] error:', err)
        setTimeout(() => {
          console.log('[liveSync] Trying to restart after error...')
          if (syncHandler) {
            syncHandler.cancel()
            syncHandler = null
            startLiveSync()
          }
        }, 5000)
      })
      .on('complete', (info) => {
        console.log('[liveSync] complete:', info)
      })
  }

  async function saveStructure(structure) {
    if (!isInitialized.value || !localDB) {
      throw new Error('Database not initialized')
    }
    try {
      let doc
      try {
        doc = await localDB.get('docStoreData')
      } catch (err) {
        if (err.status === 404) {
          doc = { _id: 'docStoreData' }
        } else {
          throw err
        }
      }

      doc.structure = structure
      doc.lastModified = new Date().toISOString()
      await localDB.put(doc)
    } catch (err) {
      console.error('Error saving structure:', err)
      throw err
    }
  }

  async function loadStructure() {
    if (!isInitialized.value || !localDB) {
      throw new Error('Database not initialized')
    }
    try {
      const doc = await localDB.get('docStoreData')
      return doc.structure
    } catch (err) {
      if (err.status !== 404) {
        console.error('Error loading structure:', err)
      }
      return null
    }
  }

  async function saveContent(fileId, text) {
    if (!isInitialized.value || !localDB) {
      throw new Error('Database not initialized')
    }
    try {
      let doc
      try {
        doc = await localDB.get(`file:${fileId}`)
      } catch (err) {
        if (err.status === 404) {
          doc = {
            _id: `file:${fileId}`,
            type: 'content',
            text: '',
            properties: '\n',
            discussions: {},
            comments: {}
          }
        } else {
          throw err
        }
      }

      if (!doc.createdTime) {
        doc.createdTime = new Date().toISOString()
      }
      doc.lastModified = new Date().toISOString()
      doc.text = text

      const response = await localDB.put(doc)
      if (response.ok) {
        doc._rev = response.rev
        return doc
      }
      return null
    } catch (err) {
      console.error(`Error saving content for file ${fileId}:`, err)
      throw err
    }
  }

  async function loadContent(fileId) {
    if (!isInitialized.value || !localDB) {
      throw new Error('Database not initialized')
    }
    if (!fileId) return null
    try {
      const doc = await localDB.get(`file:${fileId}`)
      return doc
    } catch (err) {
      if (err.status !== 404) {
        console.error(`Error loading content for file ${fileId}:`, err)
      }
      return null
    }
  }

  async function deleteContent(fileId) {
    if (!isInitialized.value || !localDB) {
      throw new Error('Database not initialized')
    }
    try {
      const doc = await localDB.get(`file:${fileId}`)
      await localDB.remove(doc)
    } catch (err) {
      if (err.status !== 404) {
        console.error(`Error deleting content for file ${fileId}:`, err)
        throw err
      }
    }
  }

  /**
   * NEW: Return all docs that start with "file:", including their doc content
   */
  async function allFileDocs() {
    if (!isInitialized.value || !localDB) {
      throw new Error('Database not initialized')
    }
    return localDB.allDocs({
      startkey: 'file:',
      endkey: 'file:\ufff0',
      include_docs: true
    })
  }

  async function destroyDB(username) {
    if (!username) return
    if (syncHandler) {
      syncHandler.cancel()
      syncHandler = null
    }
    if (localDB) {
      await localDB.close()
      localDB = null
    }
    const dbName = `pn-markdown-notes-${username.toLowerCase()}`
    const db = new PouchDB(dbName)
    await db.destroy()
    isInitialized.value = false
    console.log(`Successfully destroyed database: ${dbName}`)
  }

  function cleanup() {
    if (syncHandler) {
      syncHandler.cancel()
      syncHandler = null
    }
    if (localDB) {
      localDB.close()
      localDB = null
    }
    isInitialized.value = false
  }

  return {
    isInitialized,
    initializeDB,
    syncEnabled,
    setSyncEnabled,
    oneTimePull,
    startLiveSync,
    saveStructure,
    loadStructure,
    saveContent,
    loadContent,
    deleteContent,
    allFileDocs,    // <-- NEW method
    destroyDB,
    cleanup
  }
})

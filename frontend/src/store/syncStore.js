// src/store/syncStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'
import PouchDB from 'pouchdb-browser'
import { useAuthStore } from './authStore'

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

    // Database operations
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
                    // New file content doc
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

            // If the document is new, set createdTime
            if (!doc.createdTime) {
                doc.createdTime = new Date().toISOString()
            }
            // Always update lastModified
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

        try {
            const doc = await localDB.get(`file:${fileId}`)
            return doc
        } catch (err) {
            console.error(`Error loading content for file ${fileId}:`, err)
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

    function initSync() {
        if (!authStore.isAuthenticated) {
            console.log('User not authenticated; skipping remote sync.')
            return
        }

        if (syncHandler) {
            syncHandler.cancel()
            syncHandler = null
        }

        const remoteCouch = `http://localhost:5984/${authStore.user.dbName}`

        syncHandler = localDB.sync(remoteCouch, {
            live: true,
            retry: true,
            batch_size: 10,
            back_off_function: function (delay) {
                if (delay === 0) {
                    return 1000
                }
                return delay * 1.5
            },
            fetch: (url, opts) => {
                return fetch(url, {
                    ...opts,
                    credentials: 'include'
                })
            }
        })
            .on('change', async (info) => {
                console.log('Sync change:', info)
                if (info.direction === 'pull' && info.change.docs.length > 0) {
                    console.log('Received changes:', info.change.docs.length)
                }
            })
            .on('paused', (err) => {
                if (err) {
                    console.error('Sync paused with error:', err)
                } else {
                    console.log('Sync paused')
                }
            })
            .on('active', () => {
                console.log('Sync active')
            })
            .on('denied', (err) => {
                console.error('Sync denied:', err)
            })
            .on('error', (err) => {
                console.error('Sync error:', err)
                setTimeout(() => {
                    if (syncHandler) {
                        console.log('Attempting to restart sync after error...')
                        initSync()
                    }
                }, 5000)
            })
            .on('complete', (info) => {
                console.log('Sync completed:', info)
            })
    }

    async function initializeDB() {
        try {
            if (syncHandler) {
                syncHandler.cancel()
                syncHandler = null
            }

            if (localDB) {
                await localDB.close()
                localDB = null
            }

            const dbName = authStore.isAuthenticated
                ? `pn-markdown-notes-${authStore.user.name}`
                : 'pn-markdown-notes-guest'

            localDB = new PouchDB(dbName, {
                auto_compaction: true
            })

            authStore.registerDatabase(dbName)

            // Initialize with welcome doc if empty
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

            if (authStore.isAuthenticated) {
                initSync()
            }

            isInitialized.value = true
            console.log(`Database ${dbName} initialized successfully`)
        } catch (err) {
            console.error('Error initializing database:', err)
            throw err
        }
    }

    async function destroyDB(username) {
        try {
            if (syncHandler) {
                syncHandler.cancel()
                syncHandler = null
            }

            if (localDB) {
                await localDB.close()
                localDB = null
            }

            const dbName = `pn-markdown-notes-${username}`
            const db = new PouchDB(dbName)
            await db.destroy()

            isInitialized.value = false
            console.log(`Successfully destroyed database: ${dbName}`)
        } catch (err) {
            console.error('Error destroying database:', err)
            throw err
        }
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
        destroyDB,
        cleanup,
        saveStructure,
        loadStructure,
        saveContent,
        loadContent,
        deleteContent
    }
})

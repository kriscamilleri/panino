// src/store/authStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'
import PouchDB from 'pouchdb-browser'
import { useDocStore } from '@/store/docStore'

export const useAuthStore = defineStore('authStore', () => {
    const user = ref(null)
    const isAuthenticated = ref(false)
    const lastLoggedInUser = ref(null)

    // Track active databases to ensure proper cleanup
    const activeDatabases = new Set()

    async function login(username, password) {
        try {
            // First, check if we need to clean up previous user's data
            if (lastLoggedInUser.value && lastLoggedInUser.value !== username) {
                await cleanupPreviousUserData(lastLoggedInUser.value)
            }

            // Attempt login with CouchDB
            const response = await fetch('http://localhost:5984/_session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: username, password }),
                credentials: 'include'
            })

            if (!response.ok) {
                throw new Error('Login failed')
            }

            const data = await response.json()

            // Update user state
            user.value = {
                name: username,
                roles: data.roles,
                dbName: `userdb-${username.toLowerCase()}`
            }
            isAuthenticated.value = true
            lastLoggedInUser.value = username

            // Initialize docStore for the newly logged-in user
            const docStore = useDocStore()
            await docStore.initCouchDB()

            return true
        } catch (error) {
            console.error('Login error:', error)
            throw error
        }
    }

    async function cleanupPreviousUserData(previousUsername) {
        console.log(`Cleaning up data for previous user: ${previousUsername}`)

        // Destroy local PouchDB databases
        const dbNames = [
            `pn-markdown-notes-${previousUsername}`,
            `_pouch_pn-markdown-notes-${previousUsername}`
        ]

        for (const dbName of dbNames) {
            if (activeDatabases.has(dbName)) {
                try {
                    const db = new PouchDB(dbName)
                    await db.destroy()
                    activeDatabases.delete(dbName)
                    console.log(`Successfully destroyed database: ${dbName}`)
                } catch (err) {
                    console.error(`Error destroying database ${dbName}:`, err)
                }
            }
        }

        // Clear IndexedDB data
        try {
            const dbs = await window.indexedDB.databases()
            for (const db of dbs) {
                if (db.name.includes(previousUsername)) {
                    await window.indexedDB.deleteDatabase(db.name)
                    console.log(`Deleted IndexedDB database: ${db.name}`)
                }
            }
        } catch (err) {
            console.error('Error cleaning IndexedDB:', err)
        }
    }

    async function logout() {
        try {
            // 1. End CouchDB session
            await fetch('http://localhost:5984/_session', {
                method: 'DELETE',
                credentials: 'include'
            })

            // 2. Clean up the current user's data
            if (user.value?.name) {
                await cleanupPreviousUserData(user.value.name)
            }

            // 3. Reset auth store state
            user.value = null
            isAuthenticated.value = false
            const previousUser = lastLoggedInUser.value
            lastLoggedInUser.value = null

            // 4. Reset the docStore
            const docStore = useDocStore()
            docStore.resetStore()

            // 5. Initialize fresh guest mode
            await docStore.initCouchDB()

            console.log(`Logout complete. Cleaned up data for: ${previousUser}`)
        } catch (error) {
            console.error('Logout error:', error)
            throw error
        }
    }

    async function checkAuth() {
        try {
            const response = await fetch('http://localhost:5984/_session', {
                credentials: 'include'
            })
            const data = await response.json()

            if (data.userCtx.name) {
                // If a different user is detected, clean up previous data
                if (lastLoggedInUser.value && lastLoggedInUser.value !== data.userCtx.name) {
                    await cleanupPreviousUserData(lastLoggedInUser.value)
                }

                user.value = {
                    name: data.userCtx.name,
                    roles: data.userCtx.roles,
                    dbName: `userdb-${data.userCtx.name.toLowerCase()}`
                }
                isAuthenticated.value = true
                lastLoggedInUser.value = data.userCtx.name

                // Ensure docStore is initialized for this user
                const docStore = useDocStore()
                await docStore.initCouchDB()

                return true
            }
            return false
        } catch (error) {
            console.error('Auth check error:', error)
            return false
        }
    }

    async function signup(username, password) {
        try {
            const response = await fetch('http://localhost:3000/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            })

            const data = await response.json()
            if (!response.ok) {
                console.error('Signup error (from signup-service):', data)
                throw new Error(data.reason || data.error || 'Signup service failed')
            }

            return true
        } catch (error) {
            console.error('Signup error:', error)
            throw error
        }
    }

    // Track database creation
    function registerDatabase(dbName) {
        activeDatabases.add(dbName)
    }

    return {
        user,
        isAuthenticated,
        lastLoggedInUser,
        login,
        logout,
        checkAuth,
        signup,
        registerDatabase
    }
})
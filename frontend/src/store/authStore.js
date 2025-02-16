// src/store/authStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'
import PouchDB from 'pouchdb-browser'
import { useDocStore } from '@/store/docStore'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost'
const COUCHDB_PORT = import.meta.env.VITE_COUCHDB_PORT || '5984'
const SIGNUP_PORT = import.meta.env.VITE_SIGNUP_PORT || '3000'

const COUCHDB_URL = `${API_BASE_URL}:${COUCHDB_PORT}`
const SIGNUP_URL = `${API_BASE_URL}:${SIGNUP_PORT}`

export const useAuthStore = defineStore('authStore', () => {
    const user = ref(null)
    const isAuthenticated = ref(false)
    const lastLoggedInUser = ref(null)

    // Track active databases to ensure proper cleanup
    const activeDatabases = new Set()

    async function login(username, password) {
        try {
            // Clean up previous user's data if needed
            if (lastLoggedInUser.value && lastLoggedInUser.value.toLowerCase() !== username.toLowerCase()) {
                await cleanupPreviousUserData(lastLoggedInUser.value)
            }

            // Attempt login with CouchDB
            const response = await fetch(`${COUCHDB_URL}/_session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
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
                dbName: `pn-markdown-notes-${username.toLowerCase()}`
            }
            isAuthenticated.value = true
            lastLoggedInUser.value = username

            return true
        } catch (error) {
            console.error('Login error:', error)
            throw error
        }
    }

    async function continueAsGuest() {
        // If there's a previously logged in user, clean up that data
        if (lastLoggedInUser.value) {
            await cleanupPreviousUserData(lastLoggedInUser.value)
        }

        user.value = {
            name: 'guest',
            roles: []
        }
        isAuthenticated.value = true
        lastLoggedInUser.value = 'guest'
    }

    async function cleanupPreviousUserData(previousUsername) {
        console.log(`Cleaning up data for previous user: ${previousUsername}`)

        // Destroy local PouchDB databases that might reference the old user
        const prevLower = previousUsername.toLowerCase()
        const dbNames = [
            `pn-markdown-notes-${prevLower}`,
            `_pouch_pn-markdown-notes-${prevLower}`
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

        // Clear any old IndexedDB data that might linger
        try {
            const dbs = await window.indexedDB.databases()
            for (const db of dbs) {
                if (db.name.includes(prevLower)) {
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
            await fetch(`${COUCHDB_URL}/_session`, {
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
            docStore.destroyLocalDB(user.value?.name)

            console.log(`Logout complete. Cleaned up data for: ${previousUser}`)
        } catch (error) {
            console.error('Logout error:', error)
            throw error
        }
    }

    async function checkAuth() {
        try {
            const response = await fetch(`${COUCHDB_URL}/_session`, {
                credentials: 'include'
            })
            const data = await response.json()

            if (data.userCtx.name) {
                // If a different user is detected, clean up previous data
                if (
                    lastLoggedInUser.value &&
                    lastLoggedInUser.value.toLowerCase() !== data.userCtx.name.toLowerCase()
                ) {
                    await cleanupPreviousUserData(lastLoggedInUser.value)
                }

                user.value = {
                    name: data.userCtx.name,
                    roles: data.userCtx.roles,
                    dbName: `pn-markdown-notes-${data.userCtx.name.toLowerCase()}`
                }
                isAuthenticated.value = true
                lastLoggedInUser.value = data.userCtx.name

                return true
            }
            return false
        } catch (error) {
            console.error('Auth check error:', error)
            return false
        }
    }

    /**
     * SIGNUP now accepts a `turnstileToken` param and sends it to the signup-service
     */
    async function signup(username, password, turnstileToken = '') {
        try {
            const response = await fetch(`${SIGNUP_URL}/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    password,
                    'cf-turnstile-response': turnstileToken
                })
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
        continueAsGuest,
        registerDatabase
    }
})

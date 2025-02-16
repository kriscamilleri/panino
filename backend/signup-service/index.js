import express from 'express'
import fetch from 'node-fetch'
import cors from 'cors'
import { URLSearchParams } from 'url'  // For Turnstile verification POST body

const COUCHDB_URL = 'http://couchdb:5984'
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password'
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || ''

const app = express()
app.use(cors()) // This allows all origins
app.use(express.json())

// Health check
app.get('/', (req, res) => {
   res.send('Sign-up service is running.')
})

/**
 * POST /signup
 * Creates a user in CouchDB.
 * Expects JSON body: { username: string, password: string, cf-turnstile-response: string }
 */
app.post('/signup', async (req, res) => {
   try {
      const { username, password, 'cf-turnstile-response': turnstileToken } = req.body
      if (!username || !password) {
         return res.status(400).json({
            error: 'Missing username or password'
         })
      }

      // Verify Turnstile if a secret key is present
      if (TURNSTILE_SECRET_KEY) {
         if (!turnstileToken) {
            return res.status(400).json({
               error: 'Missing Turnstile token'
            })
         }
         // Validate with Cloudflare
         const verifyURL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
         const formData = new URLSearchParams()
         formData.append('secret', TURNSTILE_SECRET_KEY)
         formData.append('response', turnstileToken)
         console.log('Turnstile verification:', formData.toString())
         // If you have the user's IP in a header, you can append that:
         // formData.append('remoteip', req.ip)

         const turnstileRes = await fetch(verifyURL, {
            method: 'POST',
            body: formData
         })
         const turnstileData = await turnstileRes.json()

         if (!turnstileData.success) {
            console.error('Turnstile failed verification:', turnstileData)
            return res.status(400).json({
               error: 'Captcha verification failed'
            })
         }
      }

      // Create user in _users database
      const userDoc = {
         _id: `org.couchdb.user:${username}`,
         name: username,
         roles: [],
         type: 'user',
         password: password
      }

      // Create user in _users database
      const userResponse = await fetch(`${COUCHDB_URL}/_users/org.couchdb.user:${username}`, {
         method: 'PUT',
         headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64')
         },
         body: JSON.stringify(userDoc)
      })

      const userData = await userResponse.json()
      if (!userResponse.ok) {
         console.error('Failed to create user:', userData)
         return res.status(userResponse.status).json({
            error: userData.error,
            reason: userData.reason
         })
      }

      // Create user database
      const dbName = `pn-markdown-notes-${username}`
      const createDbResponse = await fetch(`${COUCHDB_URL}/${dbName}`, {
         method: 'PUT',
         headers: {
            'Authorization': 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64')
         }
      })

      if (!createDbResponse.ok) {
         const dbError = await createDbResponse.json()
         // If database already exists, continue
         if (dbError.error !== 'file_exists') {
            console.error('Failed to create database:', dbError)
            return res.status(createDbResponse.status).json({
               error: dbError.error,
               reason: dbError.reason
            })
         }
      }

      // Set security permissions for the database
      const securityDoc = {
         admins: {
            names: [],
            roles: []
         },
         members: {
            names: [username],
            roles: []
         }
      }

      const securityResponse = await fetch(`${COUCHDB_URL}/${dbName}/_security`, {
         method: 'PUT',
         headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64')
         },
         body: JSON.stringify(securityDoc)
      })

      if (!securityResponse.ok) {
         const secError = await securityResponse.json()
         console.error('Failed to set security:', secError)
         return res.status(securityResponse.status).json({
            error: secError.error,
            reason: secError.reason
         })
      }

      return res.json({
         ok: true,
         id: userData.id,
         rev: userData.rev,
         database: dbName
      })
   } catch (err) {
      console.error('Signup service error:', err)
      res.status(500).json({
         error: 'Internal Server Error',
         reason: err.message
      })
   }
})

// Start server
const port = process.env.PORT || 3000
app.listen(port, () => {
   console.log(`Signup service listening on port ${port}`)
})

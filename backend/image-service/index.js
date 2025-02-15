import express from 'express'
import cors from 'cors'
import multer from 'multer'
import fetch from 'node-fetch'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const COUCHDB_URL = process.env.COUCHDB_URL || 'http://localhost:5984'

const app = express()
app.use(cors({
    origin: true,
    credentials: true
}))

// Configure multer for handling file uploads
const storage = multer.memoryStorage()
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
})

// Helper function to get user info from session
async function getUserFromSession(cookie) {
    try {
        const sessionResponse = await fetch(`${COUCHDB_URL}/_session`, {
            headers: {
                'Cookie': cookie || ''
            }
        })

        const sessionData = await sessionResponse.json()
        if (!sessionData.userCtx.name) {
            return null
        }
        return {
            username: sessionData.userCtx.name,
            dbName: `pn-markdown-notes-${sessionData.userCtx.name.toLowerCase()}`
        }
    } catch (error) {
        console.error('Error getting user session:', error)
        return null
    }
}

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Image service is running')
})

// Upload endpoint
app.post('/upload', upload.single('image'), async (req, res) => {
    console.log("Upload request received")
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' })
        }

        const user = await getUserFromSession(req.headers.cookie)

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' })
        }

        // Create a unique document ID for the image
        const timestamp = Date.now()
        const docId = `img_${timestamp}`

        // Prepare the document with the image as an attachment
        const imageDoc = {
            _id: docId,
            type: 'image',
            filename: req.file.originalname,
            contentType: req.file.mimetype,
            uploadedAt: new Date().toISOString()
        }
        console.log(`URL = ${COUCHDB_URL}/${user.dbName}/${docId}/image?rev=`)

        // Create the document first
        const createResponse = await fetch(`${COUCHDB_URL}/${user.dbName}/${docId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': req.headers.cookie || ''
            },
            body: JSON.stringify(imageDoc)
        })

        const createData = await createResponse.json()
        if (!createResponse.ok) {
            throw new Error(createData.reason || 'Failed to create image document')
        }
        // Then add the attachment
        const attachmentResponse = await fetch(`${COUCHDB_URL}/${user.dbName}/${docId}/image?rev=${createData.rev}`, {
            method: 'PUT',
            headers: {
                'Content-Type': req.file.mimetype,
                'Cookie': req.headers.cookie || ''
            },
            body: req.file.buffer
        })

        if (!attachmentResponse.ok) {
            const attachmentError = await attachmentResponse.json()
            throw new Error(attachmentError.reason || 'Failed to upload image attachment')
        }

        // Return the URL for the uploaded image
        res.json({
            url: `/images/${docId}`,  // Return our service URL instead of direct CouchDB URL
            id: docId
        })

    } catch (error) {
        console.error('Upload error:', error)
        res.status(500).json({
            error: 'Upload failed',
            details: error.message
        })
    }
})

// Serve images endpoint
app.get('/images/:id', async (req, res) => {
    try {
        const user = await getUserFromSession(req.headers.cookie)
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' })
        }

        const imageId = req.params.id

        // First, get the document to check if it exists and get its content type
        const docResponse = await fetch(`${COUCHDB_URL}/${user.dbName}/${imageId}`, {
            headers: {
                'Cookie': req.headers.cookie || ''
            }
        })

        if (!docResponse.ok) {
            if (docResponse.status === 404) {
                return res.status(404).json({ error: 'Image not found' })
            }
            throw new Error('Failed to get image document')
        }

        const doc = await docResponse.json()

        // Get the image attachment
        const attachmentResponse = await fetch(`${COUCHDB_URL}/${user.dbName}/${imageId}/image`, {
            headers: {
                'Cookie': req.headers.cookie || ''
            }
        })

        if (!attachmentResponse.ok) {
            throw new Error('Failed to get image attachment')
        }

        // Set appropriate headers
        res.set('Content-Type', doc.contentType || 'image/jpeg')
        res.set('Cache-Control', 'public, max-age=31536000') // Cache for 1 year

        // Pipe the attachment response to our response
        attachmentResponse.body.pipe(res)

    } catch (error) {
        console.error('Error serving image:', error)
        res.status(500).json({
            error: 'Failed to serve image',
            details: error.message
        })
    }
})

const port = process.env.PORT || 3001
app.listen(port, () => {
    console.log(`Image service listening on port ${port}`)
})
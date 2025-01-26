// src/store/importExportStore.js
import { defineStore } from 'pinia'
import { useStructureStore } from './structureStore'
import { useContentStore } from './contentStore'
import { useSyncStore } from './syncStore'

// ADD these imports:
import JSZip from 'jszip'
import { saveAs } from 'file-saver'

export const useImportExportStore = defineStore('importExportStore', () => {
    const structureStore = useStructureStore()
    const contentStore = useContentStore()
    const syncStore = useSyncStore()

    async function exportData() {
        // Export in the old format for backward compatibility
        const exportData = {}

        // Export structure items
        for (const [id, item] of Object.entries(structureStore.data.structure)) {
            exportData[id] = item

            // For files, also export their content in the old format
            if (item.type === 'file') {
                try {
                    const content = await syncStore.loadContent(id)
                    if (content) {
                        exportData[`${id}/content`] = {
                            id: `${id}/content`,
                            type: 'content',
                            text: content.text,
                            properties: content.properties || '\n',
                            discussions: content.discussions || {},
                            comments: content.comments || {},
                            hash: content.hash || Date.now(),
                            tx: content.tx || Date.now()
                        }
                    }
                } catch (err) {
                    console.error(`Error exporting content for file ${id}:`, err)
                }
            }
        }

        return JSON.stringify(exportData, null, 2)
    }

    async function importData(newData) {
        try {
            if (typeof newData !== 'object' || newData === null) {
                throw new Error('Invalid data structure')
            }

            const validatedStructure = {}
            const contentPromises = []

            // First pass: validate and collect structure items
            for (const [key, item] of Object.entries(newData)) {
                if (!item || typeof item !== 'object') {
                    throw new Error(`Invalid item for key ${key}`)
                }
                if (!item.id || !item.type) {
                    throw new Error(`Missing id or type for ${key}`)
                }

                // Handle structure items (files and folders)
                if (item.type === 'file' || item.type === 'folder') {
                    if (!item.name) {
                        throw new Error(`${item.type} ${item.id} missing name`)
                    }
                    validatedStructure[item.id] = {
                        ...item,
                        hash: item.hash || Date.now(),
                        tx: item.tx || Date.now()
                    }

                    // Look for corresponding content
                    if (item.type === 'file') {
                        const contentKey = `${item.id}/content`
                        const contentItem = newData[contentKey]

                        if (contentItem && contentItem.type === 'content') {
                            contentPromises.push(
                                syncStore.saveContent(item.id, contentItem.text || '')
                            )
                        } else {
                            // If no content found, create empty content
                            contentPromises.push(
                                syncStore.saveContent(item.id, '')
                            )
                        }
                    }
                }
            }

            // Save the validated structure
            await syncStore.saveStructure(validatedStructure)
            await structureStore.loadStructure()

            // Wait for all content to be saved
            await Promise.all(contentPromises)

            // Reset UI state
            structureStore.selectedFileId = null
            structureStore.openFolders = new Set()

            // Select the first file if available
            const firstFile = Object.values(validatedStructure).find(item => item.type === 'file')
            if (firstFile) {
                await structureStore.selectFile(firstFile.id)
            }

            console.log('Import completed successfully')
        } catch (error) {
            console.error('Import failed:', error)
            throw error
        }
    }

    /**
     * NEW: Export entire workspace as a ZIP file with actual folder structure
     */
    async function exportDataAsZip() {
        // 1. Build an in-memory tree of all items from structure store
        const structure = structureStore.data.structure

        // 2. Create a new JSZip instance
        const zip = new JSZip()

        // A helper function to walk the structure tree
        async function addFolderOrFileToZip(parentZipFolder, item) {
            if (item.type === 'folder') {
                // Create a folder in the ZIP
                const newFolder = parentZipFolder.folder(item.name)
                // Then add each child
                const children = Object.values(structure).filter(
                    (child) => child.parentId === item.id
                )
                for (const child of children) {
                    await addFolderOrFileToZip(newFolder, child)
                }
            } else if (item.type === 'file') {
                // Load the file content
                const contentDoc = await syncStore.loadContent(item.id)
                const content = contentDoc?.text ?? ''
                // Create a .md file in the ZIP
                parentZipFolder.file(item.name, content)
            }
        }

        // 3. Find "root" items (no parentId) and add them
        const rootItems = Object.values(structure).filter((i) => !i.parentId)
        for (const rootItem of rootItems) {
            await addFolderOrFileToZip(zip, rootItem)
        }

        // 4. Generate the ZIP as a Blob
        const blob = await zip.generateAsync({ type: 'blob' })
        // 5. Trigger a download via file-saver
        saveAs(blob, 'markdown-notes.zip')
    }

    return {
        exportData,
        importData,
        exportDataAsZip // <--- EXPORTED
    }
})

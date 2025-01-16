// src/store/importExportStore.js
import { defineStore } from 'pinia'
import { useStructureStore } from './structureStore'
import { useContentStore } from './contentStore'
import { useSyncStore } from './syncStore'

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

    return {
        exportData,
        importData
    }
})
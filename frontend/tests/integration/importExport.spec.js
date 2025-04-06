// frontend/tests/integration/importExport.spec.js
import { test, expect } from '@playwright/test';
import { loginAsGuest, uniqueName, createFile, createFolder, selectFileInTree } from './helpers'; // Use helpers
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

// Increase timeout specifically for ZIP export test if needed
// test.setTimeout(120 * 1000); // 2 minutes for potentially slow zipping

const DEFAULT_IE_TIMEOUT = 20000; // General timeout for Import/Export tests

test.describe('Guest Mode - Import and Export', () => {

    test.beforeEach(async ({ page }) => {
        await loginAsGuest(page);
        // Ensure Welcome.md is present
        await expect(page.locator('div[role="treeitem"] span:has-text("Welcome.md")')).toBeVisible({ timeout: DEFAULT_IE_TIMEOUT });
    });

    async function openImportModal(page) {
        // Open Tools menu reliably
        const toolsButton = page.locator('nav button:has-text("Tools")');
        const importButton = page.locator('div[key="file"] button span:has-text("Import JSON")'); // Submenu button
        // Click only if submenu not visible
        if (!(await importButton.isVisible())) {
            await toolsButton.click();
        }
        await expect(importButton).toBeVisible({ timeout: DEFAULT_IE_TIMEOUT });
        await importButton.click();
        // Wait for modal header
        await expect(page.locator('h3:has-text("Import Data")')).toBeVisible({ timeout: DEFAULT_IE_TIMEOUT });
    }

    test('should open and close import modal', async ({ page }) => {
        await openImportModal(page);

        // Verify modal elements
        await expect(page.locator('textarea[placeholder="Paste your JSON data here..."]')).toBeVisible();
        await expect(page.locator('button:has-text("Choose File")')).toBeVisible();
        await expect(page.locator('div.bg-white button:has-text("Import")')).toBeDisabled(); // Target button in modal

        // Close modal via X button (assuming standard close button)
        // Update selector if the 'X' button is different
        await page.locator('div[role="dialog"] button:has(svg.lucide-x), div.bg-white button:near(h3:text("Import Data"))').first().click(); // Try targeting X icon or button near header
        await expect(page.locator('h3:has-text("Import Data")')).not.toBeVisible();

        // Reopen modal
        await openImportModal(page);

        // Close modal via Cancel button
        await page.locator('div.bg-white button:has-text("Cancel")').click();
        await expect(page.locator('h3:has-text("Import Data")')).not.toBeVisible();
    });

    test('should import valid JSON data via textarea', async ({ page }) => {
        const folderName = uniqueName('ImportFolderTX');
        const fileName = uniqueName('ImportFileTX');
        const fileContent = `# Imported Header\n\nImported content.`;

        // Generate unique IDs for the test run to avoid conflicts if run multiple times
        const folderId = `folder-${Date.now()}`;
        const fileId = `file-${Date.now() + 1}`;

        const jsonData = {
            [folderId]: { id: folderId, type: "folder", name: folderName, parentId: null, hash: Date.now(), tx: Date.now() },
            [fileId]: { id: fileId, type: "file", name: fileName, parentId: folderId, hash: Date.now(), tx: Date.now() },
            [`${fileId}/content`]: { id: `${fileId}/content`, type: "content", text: fileContent, hash: Date.now(), tx: Date.now() }
        };
        const jsonString = JSON.stringify(jsonData, null, 2);

        await openImportModal(page);

        // Paste JSON and import
        await page.locator('textarea[placeholder="Paste your JSON data here..."]').fill(jsonString);
        await expect(page.locator('div.bg-white button:has-text("Import")')).toBeEnabled();
        await page.locator('div.bg-white button:has-text("Import")').click();

        // Verify modal closed and data structure
        await expect(page.locator('h3:has-text("Import Data")')).not.toBeVisible({ timeout: DEFAULT_IE_TIMEOUT });

        // Locate items - use text selectors which are independent of generated IDs
        const folderLocator = page.locator(`div[role="treeitem"] span.font-semibold:has-text("${folderName}")`).first();
        const fileLocator = page.locator(`div[role="treeitem"] span:has-text("${fileName}")`).first();

        await expect(folderLocator).toBeVisible({ timeout: DEFAULT_IE_TIMEOUT });

        // Expand folder to see file (click chevron)
        await folderLocator.locator('../..').locator('svg.lucide-chevron-right, svg.lucide-chevron-down').first().click(); // Click chevron regardless of state
        await expect(folderLocator.locator('xpath=./ancestor::div[@role="treeitem"]/following-sibling::ul[1]')).toBeVisible(); // Wait for UL child list
        await expect(fileLocator).toBeVisible({ timeout: DEFAULT_IE_TIMEOUT });

        // Select the imported file and check content
        await selectFileInTree(page, fileName); // Use helper
        await expect(page.locator('textarea')).toHaveValue(fileContent, { timeout: DEFAULT_IE_TIMEOUT });
        await expect(page.locator('div.p-4 div[v-html] h1')).toHaveText('Imported Header', { timeout: DEFAULT_IE_TIMEOUT });
    });

    test('should show error for invalid JSON in textarea', async ({ page }) => {
        await openImportModal(page);

        // Paste invalid JSON
        await page.locator('textarea[placeholder="Paste your JSON data here..."]').fill('{invalid json');
        await expect(page.locator('div.bg-white button:has-text("Import")')).toBeEnabled(); // Import might be enabled even if JSON is bad initially
        await page.locator('div.bg-white button:has-text("Import")').click();

        // Verify error message using a robust selector
        await expect(page.locator('div[role="alert"] p, div.bg-red-50 p').first()).toContainText('Invalid JSON data', { timeout: DEFAULT_IE_TIMEOUT });

        // Modal should remain open
        await expect(page.locator('h3:has-text("Import Data")')).toBeVisible();
    });

    test('should export data as JSON correctly', async ({ page }) => {
        const fileName = uniqueName('ExportTestJSON');
        const fileContent = '# Export Content JSON';
        // Use helper to create file (ensures it's selected and saved)
        await createFile(page, fileName);
        await page.locator('textarea').fill(fileContent);
        await page.waitForTimeout(EDITOR_DEBOUNCE_WAIT); // Wait for save debounce

        // Open Tools menu reliably
        const toolsButton = page.locator('nav button:has-text("Tools")');
        const exportButton = page.locator('div[key="file"] button span:has-text("Export JSON")');
        if (!(await exportButton.isVisible())) {
            await toolsButton.click();
        }
        await expect(exportButton).toBeVisible({ timeout: DEFAULT_IE_TIMEOUT });

        // Start waiting for download before clicking
        const downloadPromise = page.waitForEvent('download', { timeout: 10000 }); // Wait up to 10s for download
        await exportButton.click();

        let download;
        try {
            download = await downloadPromise;
        } catch (e) {
            console.error("Download event timed out or failed.");
            throw e; // Re-throw error to fail the test clearly
        }


        // Verify download details
        expect(download.suggestedFilename()).toBe('markdown-notes-export.json');

        // Read the downloaded file content
        const downloadPath = await download.path();
        expect(downloadPath).toBeTruthy(); // Ensure path exists
        const fileContentString = fs.readFileSync(downloadPath, 'utf-8');
        const exportedData = JSON.parse(fileContentString);

        // Verify structure contains the created file and the welcome file
        // Find file ID by name
        const fileId = Object.keys(exportedData).find(key => exportedData[key].type === 'file' && exportedData[key].name === fileName);
        expect(fileId, `File named "${fileName}" not found in export`).toBeDefined();

        expect(exportedData[fileId]).toMatchObject({ type: 'file', name: fileName });
        expect(exportedData[`${fileId}/content`], `Content for file "${fileName}" not found or invalid`).toBeDefined();
        expect(exportedData[`${fileId}/content`]).toMatchObject({ type: 'content', text: fileContent });

        // Check guest welcome file
        expect(exportedData['welcome'], "Welcome file not found in export").toBeDefined();
        expect(exportedData['welcome']).toMatchObject({ type: 'file', name: 'Welcome.md' });
        expect(exportedData['welcome/content'], "Welcome file content not found").toBeDefined();
        expect(exportedData['welcome/content'].text).toContain('# Welcome to Markdown Editor');
    });

    // Increase timeout specifically for this test
    test('should export data as ZIP correctly', async ({ page }) => {
        test.setTimeout(120 * 1000); // 2 minutes for this specific test

        const folderName = uniqueName('ZipExportFolder');
        const fileName = uniqueName('ZipExportFile');
        const fileContent = '# Zipped Content Test';

        // Use helpers for setup
        await createFolder(page, folderName);
        await createFile(page, fileName, folderName); // Create file inside folder
        await page.locator('textarea').fill(fileContent);
        await page.waitForTimeout(EDITOR_DEBOUNCE_WAIT); // Wait for save

        // Open Tools menu reliably
        const toolsButton = page.locator('nav button:has-text("Tools")');
        const exportZipButton = page.locator('div[key="file"] button span:has-text("Export Markdown")'); // This is the ZIP export
        if (!(await exportZipButton.isVisible())) {
            await toolsButton.click();
        }
        await expect(exportZipButton).toBeVisible({ timeout: DEFAULT_IE_TIMEOUT });

        // Start waiting for download before clicking
        const downloadPromise = page.waitForEvent('download', { timeout: 60000 }); // Increased timeout for ZIP generation/download
        await exportZipButton.click();

        let download;
        try {
            download = await downloadPromise;
        } catch (e) {
            console.error("ZIP Download event timed out or failed.");
            throw e;
        }

        // Verify download details
        expect(download.suggestedFilename()).toBe('markdown-notes.zip');

        // Read the downloaded ZIP file content
        const downloadPath = await download.path();
        expect(downloadPath).toBeTruthy();
        const zipData = fs.readFileSync(downloadPath);
        const zip = await JSZip.loadAsync(zipData);

        // Verify file structure within the ZIP
        const expectedFilePath = `${folderName}/${fileName}`;
        expect(zip.files[folderName + '/'], `Folder "${folderName}/" not found in ZIP`).toBeDefined(); // Check folder entry
        expect(zip.files[expectedFilePath], `File "${expectedFilePath}" not found in ZIP`).toBeDefined(); // Check file inside folder
        const zippedFileContent = await zip.files[expectedFilePath].async('string');
        expect(zippedFileContent).toBe(fileContent);

        // Check for welcome file at root
        expect(zip.files['Welcome.md'], "Welcome.md not found at ZIP root").toBeDefined();
        const welcomeContent = await zip.files['Welcome.md'].async('string');
        expect(welcomeContent).toContain('# Welcome to Markdown Editor');
    });

    // Skipping file chooser test - requires interaction beyond typical browser automation
    test.skip('should import valid JSON via file chooser', async ({ page }) => {
        test.info().annotations.push({ type: 'info', description: 'Skipped: File chooser interaction is complex and often environment-dependent.' });
        // ... (keep existing skipped logic) ...
    });

});
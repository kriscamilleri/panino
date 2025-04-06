// frontend/tests/integration/documents.spec.js
import { test, expect } from '@playwright/test';
import { loginAsGuest, uniqueName, createFile, createFolder, openTreeItemContextMenu, selectFolderInTree, selectFileInTree } from './helpers'; // Use helpers

const DEFAULT_DOC_TIMEOUT = 15000;

test.describe('Guest Mode - Documents Tree Operations', () => {

    // Use beforeEach common setup: login as guest
    test.beforeEach(async ({ page }) => {
        await loginAsGuest(page);
        // Ensure default state is loaded
        await expect(page.locator('div[role="treeitem"] span:has-text("Welcome.md")')).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        // Check that welcome file is selected by default
        await expect(page).toHaveURL(/\/doc\/welcome/, { timeout: DEFAULT_DOC_TIMEOUT });
        await expect(page.locator('textarea')).toHaveValue(/# Welcome to Markdown Editor/, { timeout: DEFAULT_DOC_TIMEOUT });
    });

    test('should create a new file at the root', async ({ page }) => {
        const fileName = uniqueName('FileRoot');
        await createFile(page, fileName); // Helper handles creation and basic checks
        // Additional check: ensure editor is focused maybe?
        await expect(page.locator('textarea')).toBeFocused();
    });

    test('should create a new folder at the root', async ({ page }) => {
        const folderName = uniqueName('FolderRoot');
        await createFolder(page, folderName); // Helper handles creation and basic checks
        // Check folder preview explicitly
        await expect(page.locator(`//h2[normalize-space()='${folderName}']`)).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        // Check URL hasn't changed to a doc URL
        expect(page.url()).not.toMatch(/\/doc\//);
    });

    test('should create a file inside a folder using context menu', async ({ page }) => {
        const folderName = uniqueName('ParentFolderCtx');
        const fileName = uniqueName('ChildFileCtx');

        // Create the parent folder first
        await createFolder(page, folderName);

        // Create the file inside using the helper, specifying parent
        await createFile(page, fileName, folderName);

        // Helper createFile already verifies visibility and selection.
        // Add an extra check maybe:
        const parentFolderItem = page.locator(`div[role="treeitem"]:has(span.font-semibold:text-is("${folderName}"))`).first();
        await expect(parentFolderItem.locator(`xpath=./following-sibling::ul[1]//span[normalize-space()="${fileName}"]`)).toBeVisible();
    });

    test('should create a folder inside a folder using context menu', async ({ page }) => {
        const parentFolderName = uniqueName('ParentFolderL2');
        const childFolderName = uniqueName('ChildFolderL2');

        await createFolder(page, parentFolderName);
        await createFolder(page, childFolderName, parentFolderName); // Use helper with parent name

        // Helper createFolder already verifies visibility and selection.
        const parentFolderItem = page.locator(`div[role="treeitem"]:has(span.font-semibold:text-is("${parentFolderName}"))`).first();
        await expect(parentFolderItem.locator(`xpath=./following-sibling::ul[1]//span[normalize-space()="${childFolderName}"]`)).toBeVisible();
        await expect(page.locator(`//h2[normalize-space()='${childFolderName}']`)).toBeVisible(); // Check FolderPreview title
    });

    test('should rename a file using context menu', async ({ page }) => {
        const oldName = uniqueName('RenameFile');
        const newName = uniqueName('RenamedFile');
        await createFile(page, oldName); // Creates and selects the file
        await expect(page.locator('textarea')).toBeFocused(); // Ensure editor has focus

        // Use helper to open context menu
        await openTreeItemContextMenu(page, oldName);

        // Perform rename action
        await page.locator('div.fixed button:has-text("Rename")').click();
        await expect(page.locator('h3:has-text("Rename File")')).toBeVisible(); // Modal title check is case-sensitive
        await page.locator('input[placeholder="Enter new File name"]').fill(newName); // Use correct placeholder
        await page.locator('div.bg-white button:has-text("Rename")').click(); // Target rename button in modal

        // Verify changes
        await expect(page.locator('h3:has-text("Rename File")')).not.toBeVisible();
        await expect(page.locator(`div[role="treeitem"] span:has-text("${oldName}")`)).not.toBeVisible();
        await expect(page.locator(`div[role="treeitem"] span:has-text("${newName}")`)).toBeVisible();

        // Verify editor content is retained (should still be empty) and file is still selected
        await expect(page.locator('textarea')).toHaveValue('');
        await expect(page).toHaveURL(new RegExp(`/doc/${newName.toLowerCase()}|/doc/[a-zA-Z0-9]+`), { timeout: DEFAULT_DOC_TIMEOUT }); // URL might use ID, check pattern
    });

    test('should rename a folder using context menu', async ({ page }) => {
        const oldName = uniqueName('RenameFolder');
        const newName = uniqueName('RenamedFolder');
        await createFolder(page, oldName); // Creates and selects the folder

        await openTreeItemContextMenu(page, oldName);

        await page.locator('div.fixed button:has-text("Rename")').click();
        await expect(page.locator('h3:has-text("Rename Folder")')).toBeVisible();
        await page.locator('input[placeholder="Enter new Folder name"]').fill(newName);
        await page.locator('div.bg-white button:has-text("Rename")').click();

        await expect(page.locator('h3:has-text("Rename Folder")')).not.toBeVisible();
        await expect(page.locator(`div[role="treeitem"] span.font-semibold:has-text("${oldName}")`)).not.toBeVisible();
        await expect(page.locator(`div[role="treeitem"] span.font-semibold:has-text("${newName}")`)).toBeVisible();

        // Verify folder preview title updated
        await expect(page.locator(`//h2[normalize-space()='${newName}']`)).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
    });


    test('should delete a file using context menu', async ({ page }) => {
        const fileName = uniqueName('DeleteFile');
        await createFile(page, fileName); // Creates and selects

        await openTreeItemContextMenu(page, fileName);

        // Handle confirmation dialog
        page.once('dialog', dialog => dialog.accept());
        await page.locator('div.fixed button:has-text("Delete")').click();

        // Verify file is gone from tree
        await expect(page.locator(`div[role="treeitem"] span:has-text("${fileName}")`)).not.toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });

        // Verify editor goes back to default state (e.g., Recent Docs or Welcome)
        // Check for "Recent Documents" title or select Welcome.md again
        await expect(page.locator('h2:has-text("Recent Documents")')).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        // Or check if Welcome.md is selected
        // await expect(page).toHaveURL(/\/doc\/welcome/, { timeout: DEFAULT_DOC_TIMEOUT });
    });

    test('should delete a folder (and its contents) using context menu', async ({ page }) => {
        const folderName = uniqueName('DeleteFolderWithFile');
        const fileName = uniqueName('FileInDeleteFolder');

        // Use helpers to create folder and file inside it
        await createFolder(page, folderName);
        await createFile(page, fileName, folderName);

        // Select the folder to delete it
        await selectFolderInTree(page, folderName);
        await openTreeItemContextMenu(page, folderName);

        // Handle confirmation
        page.once('dialog', dialog => dialog.accept());
        await page.locator('div.fixed button:has-text("Delete")').click();

        // Verify folder and file are gone
        await expect(page.locator(`div[role="treeitem"] span.font-semibold:has-text("${folderName}")`)).not.toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(page.locator(`div[role="treeitem"] span:has-text("${fileName}")`)).not.toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });

        // Verify view changed back to root/recent
        await expect(page.locator('h2:has-text("Recent Documents")')).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
    });

    test('should toggle folder open/close via chevron', async ({ page }) => {
        const folderName = uniqueName('ToggleFolderChevron');
        const fileName = uniqueName('ToggleFileChevron');

        await createFolder(page, folderName);
        await createFile(page, fileName, folderName); // Create file inside

        const folderItem = page.locator(`div[role="treeitem"]:has(span.font-semibold:text-is("${folderName}"))`).first();
        const chevronDown = folderItem.locator('svg.lucide-chevron-down');
        const chevronRight = folderItem.locator('svg.lucide-chevron-right');
        const fileInList = folderItem.locator(`xpath=./following-sibling::ul[1]//span[normalize-space()="${fileName}"]`);

        // Should be open initially after file creation inside it
        await expect(chevronDown).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(chevronRight).not.toBeVisible();
        await expect(fileInList).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });

        // Click chevron to close
        await chevronDown.click();
        await expect(chevronDown).not.toBeVisible();
        await expect(chevronRight).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(fileInList).not.toBeVisible();


        // Click chevron to open again
        await chevronRight.click();
        await expect(chevronDown).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(chevronRight).not.toBeVisible();
        await expect(fileInList).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
    });

    test('should search for files and folders accurately', async ({ page }) => {
        const folderName = uniqueName('SearchFolderUnique');
        const fileName1 = uniqueName('SearchFileUnique1');
        const fileName2 = uniqueName('AnotherFileUnique');

        await createFolder(page, folderName);
        await createFile(page, fileName1, folderName);
        await createFile(page, fileName2); // Root file

        // Locate search elements
        const searchToggle = page.locator('button[title="Toggle Search"]');
        const searchInput = page.locator('input[placeholder="Search files and folders..."]');
        const clearSearchButton = page.locator('button[aria-label="Clear search"]'); // Assuming X button has this label or similar attribute

        // Open search bar
        await searchToggle.click();
        await expect(searchInput).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(searchInput).toBeFocused();

        // Define locators for items
        const folderLocator = page.locator(`div[role="treeitem"] span.font-semibold:has-text("${folderName}")`);
        const file1Locator = page.locator(`div[role="treeitem"] span:has-text("${fileName1}")`);
        const file2Locator = page.locator(`div[role="treeitem"] span:has-text("${fileName2}")`);
        const welcomeLocator = page.locator('div[role="treeitem"] span:has-text("Welcome.md")');


        // --- Search for folder ---
        await searchInput.fill(folderName);
        // Wait for results to filter - use visibility check of expected items
        await expect(folderLocator).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(file1Locator).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT }); // Child file should also show if parent matches
        await expect(file2Locator).not.toBeVisible();
        await expect(welcomeLocator).not.toBeVisible();

        // --- Search for file 1 (inside folder) ---
        await searchInput.fill(fileName1);
        await expect(folderLocator).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT }); // Parent should still show
        await expect(file1Locator).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(file2Locator).not.toBeVisible();

        // --- Search for file 2 (root file) ---
        await searchInput.fill(fileName2);
        await expect(file2Locator).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(folderLocator).not.toBeVisible();
        await expect(file1Locator).not.toBeVisible();

        // --- Search for common part 'Unique' ---
        await searchInput.fill('Unique');
        await expect(folderLocator).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(file1Locator).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(file2Locator).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(welcomeLocator).not.toBeVisible();

        // --- Clear search with button ---
        await expect(clearSearchButton).toBeVisible();
        await clearSearchButton.click();
        await expect(searchInput).toHaveValue('');
        // Verify all items are visible again (assuming folders don't auto-collapse)
        await expect(folderLocator).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(file1Locator).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT }); // File inside should be visible if folder is open
        await expect(file2Locator).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });
        await expect(welcomeLocator).toBeVisible({ timeout: DEFAULT_DOC_TIMEOUT });

        // --- Close search bar ---
        await searchToggle.click();
        await expect(searchInput).not.toBeVisible();
    });

});
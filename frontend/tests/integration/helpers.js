// frontend/tests/integration/helpers.js
import { expect } from '@playwright/test';

// Increased default timeout for potentially slower CI or complex setup
const DEFAULT_WAIT_TIMEOUT = 2000; // 15 seconds

export async function loginAsGuest(page) {
    await page.goto('/');
    // Wait specifically for the login form elements to be ready
    await expect(page.locator('h3:has-text("Sign In")')).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });
    await expect(page.locator('button:has-text("Continue as guest")')).toBeEnabled({ timeout: DEFAULT_WAIT_TIMEOUT });

    await page.locator('button:has-text("Continue as guest")').click();

    // Wait for loading screen and then the final home page URL
    await page.waitForURL('**/#/loading*', { timeout: DEFAULT_WAIT_TIMEOUT });
    await page.waitForURL('**/#/', { timeout: DEFAULT_WAIT_TIMEOUT }); // Wait for hash route

    // Verify core home page elements are visible after login
    await expect(page.locator('nav button span:has-text("Format")')).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });
    await expect(page.locator('aside h2:has-text("Documents")')).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT }); // Assuming Documents is in aside
}

export async function loginAsUser(page, username, password) {
    await page.goto('/');
    await expect(page.locator('h3:has-text("Sign In")')).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });
    await page.locator('input#username').fill(username);
    await page.locator('input#password').fill(password);
    await expect(page.locator('button:has-text("Sign in")')).toBeEnabled();
    await page.locator('button:has-text("Sign in")').click();

    await page.waitForURL('**/#/loading*', { timeout: DEFAULT_WAIT_TIMEOUT });
    await page.waitForURL('**/#/', { timeout: DEFAULT_WAIT_TIMEOUT });

    await expect(page.locator('nav button span:has-text("Format")')).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });
    await expect(page.locator('aside h2:has-text("Documents")')).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });

    // Use a more robust selector for the username display, possibly checking within the specific desktop nav area
    const desktopNavUser = page.locator('.hidden.md\\:flex > div:not(:has(button)):not(:has(a))'); // Target div in desktop nav that isn't a button/link container
    await expect(desktopNavUser).toContainText(username, { ignoreCase: true, timeout: DEFAULT_WAIT_TIMEOUT });
}

export async function logout(page) {
    // Target the logout button specifically within the desktop navigation area
    const logoutButton = page.locator('.hidden.md\\:flex button:has-text("Logout")');
    await expect(logoutButton).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });
    await logoutButton.click();

    // Wait for redirection to login page
    await page.waitForURL('**/#/login', { timeout: DEFAULT_WAIT_TIMEOUT });
    await expect(page.locator('h3:has-text("Sign In")')).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });
}

export function uniqueName(prefix = 'Test') {
    // Keep it simple, ensure it's a valid DOM selector part if used directly
    return `${prefix}_${Date.now()}`;
}

// Helper to select a file in the tree - waits for editor to show file name (implicitly waits for selection)
export async function selectFileInTree(page, fileName) {
    const fileLocator = page.locator(`div[role="treeitem"] span:has-text("${fileName}")`).first();
    await expect(fileLocator).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });
    await fileLocator.click();
    // Wait for URL update AND editor/preview area to potentially update/load
    await page.waitForURL(/\/doc\//, { timeout: DEFAULT_WAIT_TIMEOUT });
    // Add a check if editor content is expected, e.g., expect(page.locator('textarea')).toContainText(...)
    // Or wait for a specific element in the preview if applicable
    await page.waitForTimeout(200); // Small buffer for reactive updates
}

// Helper to select a folder in the tree - waits for folder preview title
export async function selectFolderInTree(page, folderName) {
    const folderLocator = page.locator(`div[role="treeitem"] span.font-semibold:has-text("${folderName}")`).first();
    await expect(folderLocator).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });
    await folderLocator.click();
    // Expect FolderPreview title to appear
    await expect(page.locator(`//h2[normalize-space()='${folderName}']`)).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });
    // Ensure we are NOT on a doc page
    expect(page.url()).not.toMatch(/\/doc\//);
    await page.waitForTimeout(100); // Small buffer
}

// Helper function to reliably open the context menu for a tree item
export async function openTreeItemContextMenu(page, itemText) {
    // Find the tree item container (file or folder)
    // Using XPath to find the div that contains the specific text, then go to parent div[role=treeitem] if needed
    // This handles both file spans and folder spans (which might be nested)
    const itemContainerLocator = page.locator(`div[role="treeitem"]:has(span:text-is("${itemText}"))`).first();
    await expect(itemContainerLocator).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });

    // Click the item first to ensure it's selected/focused, which often reveals the 'more' button
    await itemContainerLocator.click();
    await page.waitForTimeout(100); // Brief pause for UI state update

    // Find the 'more' button *within* this item's container
    // Exclude buttons related to search/add which might be siblings at a higher level
    const moreButton = itemContainerLocator.locator('button[title="More options"], button:not([title*="Search"]):not([title*="New"]):not([title*="Toggle"])').last(); // Try common title or exclude known ones

    await expect(moreButton).toBeVisible({ timeout: 10000 }); // Wait longer for button if needed
    await moreButton.click();

    // Verify context menu is visible by checking for a known item like 'Rename'
    await expect(page.locator('div.fixed button:has-text("Rename")')).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });
    await expect(page.locator('div.fixed button:has-text("Delete")')).toBeVisible();
}

// Helper function to create a file, optionally inside a folder
export async function createFile(page, name, parentFolderName = null) {
    if (parentFolderName) {
        await selectFolderInTree(page, parentFolderName); // Select the parent folder first
        await page.waitForTimeout(100); // Allow selection state to settle
        // Open context menu on the *selected* folder to create inside it
        await openTreeItemContextMenu(page, parentFolderName);
        await page.locator('div.fixed button:has-text("New File")').click();
    } else {
        // Use global 'New File' button for root creation
        await expect(page.locator('button[title="New File"]')).toBeVisible();
        await page.locator('button[title="New File"]').click();
    }

    // Handle the creation modal
    await expect(page.locator('h3:has-text("Create New File")')).toBeVisible();
    await page.locator('input[placeholder="Enter File name"]').fill(name);
    await expect(page.locator('div.bg-white button:has-text("Create")')).toBeEnabled();
    await page.locator('div.bg-white button:has-text("Create")').click(); // Target button within modal more specifically

    // Wait for modal to disappear and file to appear in the tree
    await expect(page.locator('h3:has-text("Create New File")')).not.toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });
    const fileLocator = page.locator(`div[role="treeitem"] span:has-text("${name}")`).first();
    await expect(fileLocator).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });

    // If created in a folder, ensure the folder is expanded (it should be after creation)
    if (parentFolderName) {
        const parentFolderItem = page.locator(`div[role="treeitem"]:has(span.font-semibold:text-is("${parentFolderName}"))`).first();
        await expect(parentFolderItem.locator('svg.lucide-chevron-down')).toBeVisible(); // Check chevron is down
        await expect(parentFolderItem.locator(`xpath=./following-sibling::ul[1]//span[normalize-space()="${name}"]`)).toBeVisible();
    }

    // Automatically select the newly created file to check editor state
    await fileLocator.click();
    await page.waitForURL(/\/doc\//, { timeout: DEFAULT_WAIT_TIMEOUT });
    await expect(page.locator('textarea')).toHaveValue(''); // Newly created file should be empty
}

// Helper function to create a folder, optionally inside another folder
export async function createFolder(page, name, parentFolderName = null) {
    if (parentFolderName) {
        await selectFolderInTree(page, parentFolderName);
        await page.waitForTimeout(100);
        await openTreeItemContextMenu(page, parentFolderName);
        await page.locator('div.fixed button:has-text("New Folder")').click();
    } else {
        await expect(page.locator('button[title="New Folder"]')).toBeVisible();
        await page.locator('button[title="New Folder"]').click();
    }

    // Handle creation modal
    await expect(page.locator('h3:has-text("Create New Folder")')).toBeVisible();
    await page.locator('input[placeholder="Enter Folder name"]').fill(name);
    await expect(page.locator('div.bg-white button:has-text("Create")')).toBeEnabled();
    await page.locator('div.bg-white button:has-text("Create")').click();

    // Wait for modal to close and folder to appear
    await expect(page.locator('h3:has-text("Create New Folder")')).not.toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });
    const folderLocator = page.locator(`div[role="treeitem"] span.font-semibold:has-text("${name}")`).first();
    await expect(folderLocator).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT });

    if (parentFolderName) {
        const parentFolderItem = page.locator(`div[role="treeitem"]:has(span.font-semibold:text-is("${parentFolderName}"))`).first();
        await expect(parentFolderItem.locator('svg.lucide-chevron-down')).toBeVisible();
        await expect(parentFolderItem.locator(`xpath=./following-sibling::ul[1]//span[normalize-space()="${name}"]`)).toBeVisible();
    }

    // Automatically select the newly created folder
    await folderLocator.click();
    await expect(page.locator(`//h2[normalize-space()='${name}']`)).toBeVisible({ timeout: DEFAULT_WAIT_TIMEOUT }); // Check FolderPreview title
}
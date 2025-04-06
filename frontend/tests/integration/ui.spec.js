// frontend/tests/integration/ui.spec.js
import { test, expect } from '@playwright/test';
import { loginAsGuest } from './helpers';

const DEFAULT_UI_TIMEOUT = 15000;

// Helper to reliably open a specific main menu and wait for its submenu
async function openMainMenu(page, menuName, submenuItemSelector) {
    const menuButton = page.locator(`nav button:has-text("${menuName}")`);
    const submenuItem = page.locator(submenuItemSelector);

    // Click only if submenu not already visible
    if (!(await submenuItem.isVisible())) {
        await menuButton.click();
    }
    await expect(submenuItem).toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });
}

test.describe('Guest Mode - UI Panel and Menu Interactions', () => {

    test.beforeEach(async ({ page }) => {
        await loginAsGuest(page);
    });

    test('should toggle Documents panel via View menu', async ({ page }) => {
        const documentsPanel = page.locator('aside:has(h2:text("Documents"))'); // Target the aside element
        const documentsToggle = page.locator('div[key="view"] button span:has-text("Documents")'); // Submenu button

        // Initially visible
        await expect(documentsPanel).toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });

        // Open View menu and click toggle
        await openMainMenu(page, 'View', 'div[key="view"] button span:has-text("Documents")');
        await documentsToggle.click();
        await expect(documentsPanel).not.toBeVisible({ timeout: DEFAULT_UI_TIMEOUT }); // Wait for it to disappear

        // Toggle back on
        await openMainMenu(page, 'View', 'div[key="view"] button span:has-text("Documents")');
        await documentsToggle.click();
        await expect(documentsPanel).toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });
    });

    test('should toggle Editor panel via View menu', async ({ page }) => {
        const editorPanel = page.locator('textarea'); // Assuming only one main textarea
        const editorToggle = page.locator('div[key="view"] button span:has-text("Editor")');

        await expect(editorPanel).toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });

        await openMainMenu(page, 'View', 'div[key="view"] button span:has-text("Editor")');
        await editorToggle.click();
        await expect(editorPanel).not.toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });

        // Toggle back on
        await openMainMenu(page, 'View', 'div[key="view"] button span:has-text("Editor")');
        await editorToggle.click();
        await expect(editorPanel).toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });
    });

    test('should toggle Preview panel via View menu', async ({ page }) => {
        const previewPanel = page.locator('div.p-4 div[v-html]'); // Specific preview container
        const previewToggle = page.locator('div[key="view"] button span:has-text("Preview")');

        await expect(previewPanel).toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });

        await openMainMenu(page, 'View', 'div[key="view"] button span:has-text("Preview")');
        await previewToggle.click();
        await expect(previewPanel).not.toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });

        // Toggle back on
        await openMainMenu(page, 'View', 'div[key="view"] button span:has-text("Preview")');
        await previewToggle.click();
        await expect(previewPanel).toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });
    });

    test('should show only one submenu at a time', async ({ page }) => {
        const formatButton = page.locator('nav button:has-text("Format")');
        const viewButton = page.locator('nav button:has-text("View")');
        const toolsButton = page.locator('nav button:has-text("Tools")');

        const formatSubMenuPanel = page.locator('div.flex.flex-wrap.gap-2[key="tools"]'); // Based on SubMenuBar keys
        const viewSubMenuPanel = page.locator('div.flex.flex-wrap.gap-2[key="view"]');
        const toolsSubMenuPanel = page.locator('div.flex.flex-wrap.gap-2[key="file"]');

        // Initially no submenus visible
        await expect(formatSubMenuPanel).not.toBeVisible();
        await expect(viewSubMenuPanel).not.toBeVisible();
        await expect(toolsSubMenuPanel).not.toBeVisible();

        // Open View
        await viewButton.click();
        await expect(viewSubMenuPanel).toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });
        await expect(formatSubMenuPanel).not.toBeVisible();
        await expect(toolsSubMenuPanel).not.toBeVisible();

        // Open Format (should close View)
        await formatButton.click();
        await expect(formatSubMenuPanel).toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });
        await expect(viewSubMenuPanel).not.toBeVisible();
        await expect(toolsSubMenuPanel).not.toBeVisible();

        // Open Tools (should close Format)
        await toolsButton.click();
        await expect(toolsSubMenuPanel).toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });
        await expect(formatSubMenuPanel).not.toBeVisible();
        await expect(viewSubMenuPanel).not.toBeVisible();

        // Click Tools again to close
        await toolsButton.click();
        await expect(toolsSubMenuPanel).not.toBeVisible();
    });

    test('should toggle mobile menu', async ({ page, isMobile }) => {
        // Skip this test if not in mobile viewport configuration
        test.skip(!isMobile, 'This test is only relevant for mobile viewports.');

        // Use a more specific selector for the hamburger button if possible
        const hamburgerButton = page.locator('nav button:has(svg.lucide-menu)'); // Target button containing the Menu icon
        const mobileMenuContainer = page.locator('div.md\\:hidden.border-t'); // The container for MobileMenu.vue
        const logoutButtonMobile = mobileMenuContainer.locator('button span:has-text("Logout")');

        // Initially menu is closed
        await expect(mobileMenuContainer).not.toBeVisible();

        // Click hamburger to open
        await expect(hamburgerButton).toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });
        await hamburgerButton.click();
        await expect(mobileMenuContainer).toBeVisible({ timeout: DEFAULT_UI_TIMEOUT });
        await expect(logoutButtonMobile).toBeVisible(); // Check content

        // Click hamburger again to close
        await hamburgerButton.click();
        await expect(mobileMenuContainer).not.toBeVisible();
    });

    // Skipping resize tests due to complexity
    test.skip('should resize documents panel', async ({ page }) => {
        test.info().annotations.push({ type: 'info', description: 'Skipped: Resizing tests involve complex drag simulation.' });
        // ... (keep existing skipped logic) ...
    });

});
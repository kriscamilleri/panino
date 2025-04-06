// frontend/tests/integration/settings.spec.js
import { test, expect } from '@playwright/test';
import { loginAsGuest } from './helpers';

const DEFAULT_SETTINGS_TIMEOUT = 15000;

test.describe('Guest Mode - Settings Pages', () => {

    test.beforeEach(async ({ page }) => {
        await loginAsGuest(page);
    });

    async function navigateToPreviewStyles(page) {
        const viewButton = page.locator('nav button:has-text("View")');
        const stylesButton = page.locator('div[key="view"] button span:has-text("Preview Styles")');
        if (!(await stylesButton.isVisible())) {
            await viewButton.click();
        }
        await expect(stylesButton).toBeVisible({ timeout: DEFAULT_SETTINGS_TIMEOUT });
        await stylesButton.click();
        await page.waitForURL('**/#/styles', { timeout: DEFAULT_SETTINGS_TIMEOUT });
        await expect(page.locator('h1:has-text("Customize Markdown Styles")')).toBeVisible({ timeout: DEFAULT_SETTINGS_TIMEOUT });
    }

    async function navigateToPrintStyles(page) {
        const toolsButton = page.locator('nav button:has-text("Tools")');
        const printStylesButton = page.locator('div[key="file"] button span:has-text("Print Styles")');
        if (!(await printStylesButton.isVisible())) {
            await toolsButton.click();
        }
        await expect(printStylesButton).toBeVisible({ timeout: DEFAULT_SETTINGS_TIMEOUT });
        await printStylesButton.click();
        await page.waitForURL('**/#/print-styles', { timeout: DEFAULT_SETTINGS_TIMEOUT });
        await expect(page.locator('h1:has-text("Customize Print Styles")')).toBeVisible({ timeout: DEFAULT_SETTINGS_TIMEOUT });
    }


    test.describe('Preview Styles Page', () => {

        test.beforeEach(async ({ page }) => {
            await navigateToPreviewStyles(page);
        });

        test('should display style inputs and preview', async ({ page }) => {
            // Check for common inputs using getByLabel for better accessibility targeting
            await expect(page.getByLabel('h1', { exact: true })).toBeVisible();
            await expect(page.getByLabel('p', { exact: true })).toBeVisible();
            await expect(page.getByLabel('a', { exact: true })).toBeVisible();

            // Check preview rendering of specific elements more robustly
            const previewPane = page.locator('div.prose'); // Target the prose container
            await expect(previewPane).toBeVisible();
            await expect(previewPane.locator('h1').first()).toBeVisible();
            await expect(previewPane.locator('p').first()).toBeVisible();
            await expect(previewPane.locator('a').first()).toBeVisible();
        });

        test('should update preview when a style input changes', async ({ page }) => {
            const h1Input = page.getByLabel('h1', { exact: true });
            const previewH1 = page.locator('.prose h1').first();

            const initialH1Class = await h1Input.inputValue();
            // Use expect.stringContaining for robustness against other potential classes
            await expect(previewH1).toHaveAttribute('class', expect.stringContaining(initialH1Class.split(' ')[0]), { timeout: DEFAULT_SETTINGS_TIMEOUT });

            // Change H1 style
            const newH1Class = initialH1Class + ' text-red-500 underline';
            await h1Input.fill(newH1Class);
            // Wait for the attribute to contain the *new* classes
            await expect(previewH1).toHaveAttribute('class', expect.stringContaining('text-red-500'), { timeout: DEFAULT_SETTINGS_TIMEOUT });
            await expect(previewH1).toHaveAttribute('class', expect.stringContaining('underline'), { timeout: DEFAULT_SETTINGS_TIMEOUT });

            // Change back and verify new classes are removed
            await h1Input.fill(initialH1Class);
            await expect(previewH1).not.toHaveAttribute('class', expect.stringContaining('text-red-500'), { timeout: DEFAULT_SETTINGS_TIMEOUT });
            await expect(previewH1).not.toHaveAttribute('class', expect.stringContaining('underline'), { timeout: DEFAULT_SETTINGS_TIMEOUT });
            await expect(previewH1).toHaveAttribute('class', expect.stringContaining(initialH1Class.split(' ')[0]), { timeout: DEFAULT_SETTINGS_TIMEOUT }); // Check original base class still there
        });

        test('should navigate back to home page using Back button', async ({ page }) => {
            await page.locator('nav button:has-text("Back")').click();
            await page.waitForURL('**/#/', { timeout: DEFAULT_SETTINGS_TIMEOUT }); // Expect to land on home page
            await expect(page.locator('nav button span:has-text("Format")')).toBeVisible(); // Check home page element
        });
    });

    test.describe('Print Styles Page', () => {

        test.beforeEach(async ({ page }) => {
            await navigateToPrintStyles(page);
        });

        test('should display print style inputs and preview', async ({ page }) => {
            await expect(page.getByLabel('h1', { exact: true })).toBeVisible();
            await expect(page.getByLabel('p', { exact: true })).toBeVisible();
            await expect(page.getByLabel('Print Header HTML')).toBeVisible();
            await expect(page.locator('textarea#printHeaderHtml')).toBeVisible();
            await expect(page.getByLabel('Print Footer HTML')).toBeVisible();
            await expect(page.locator('textarea#printFooterHtml')).toBeVisible();

            // Check preview rendering
            const previewPane = page.locator('div.prose');
            await expect(previewPane.locator('h1').first()).toBeVisible();
            await expect(previewPane.locator('p').first()).toBeVisible();
        });

        test('should update preview when print style input changes', async ({ page }) => {
            const h1Input = page.getByLabel('h1', { exact: true });
            const previewH1 = page.locator('.prose h1').first();

            const initialH1Class = await h1Input.inputValue();
            await expect(previewH1).toHaveAttribute('class', expect.stringContaining(initialH1Class.split(' ')[0]), { timeout: DEFAULT_SETTINGS_TIMEOUT });

            const newH1Class = initialH1Class + ' text-blue-800';
            await h1Input.fill(newH1Class);
            await expect(previewH1).toHaveAttribute('class', expect.stringContaining('text-blue-800'), { timeout: DEFAULT_SETTINGS_TIMEOUT });

            await h1Input.fill(initialH1Class); // Change back
            await expect(previewH1).not.toHaveAttribute('class', expect.stringContaining('text-blue-800'), { timeout: DEFAULT_SETTINGS_TIMEOUT });
        });

        test('should update preview when header/footer HTML changes (verify input persistence)', async ({ page }) => {
            const headerInput = page.getByLabel('Print Header HTML');
            const footerInput = page.getByLabel('Print Footer HTML');

            const headerText = '<div id="custom-header">My Print Header</div>';
            const footerText = '<div id="custom-footer">My Print Footer</div>';

            await headerInput.fill(headerText);
            await footerInput.fill(footerText);

            // Verify inputs hold the value
            await expect(headerInput).toHaveValue(headerText);
            await expect(footerInput).toHaveValue(footerText);

            // Reload to check persistence (basic check)
            await page.reload();
            await page.waitForURL('**/#/print-styles', { timeout: DEFAULT_SETTINGS_TIMEOUT }); // Wait for page reload
            // Re-locate elements after reload
            const headerInputAfterReload = page.getByLabel('Print Header HTML');
            const footerInputAfterReload = page.getByLabel('Print Footer HTML');
            await expect(headerInputAfterReload).toHaveValue(headerText, { timeout: DEFAULT_SETTINGS_TIMEOUT });
            await expect(footerInputAfterReload).toHaveValue(footerText, { timeout: DEFAULT_SETTINGS_TIMEOUT });
        });

        test('should navigate back to home page using Back button', async ({ page }) => {
            await page.locator('nav button:has-text("Back")').click();
            await page.waitForURL('**/#/', { timeout: DEFAULT_SETTINGS_TIMEOUT });
            await expect(page.locator('nav button span:has-text("Format")')).toBeVisible();
        });
    });

});
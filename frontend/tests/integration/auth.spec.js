// frontend/tests/integration/auth.spec.js
import { test, expect } from '@playwright/test';
import { loginAsGuest, loginAsUser, logout, uniqueName } from './helpers';

const DEFAULT_AUTH_TIMEOUT = 20000; // Longer timeout for auth/loading operations

test.describe('Authentication and Navigation', () => {

    test('should load login page by default', async ({ page }) => {
        await page.goto('/');
        await page.waitForURL('**/#/login', { timeout: DEFAULT_AUTH_TIMEOUT });
        await expect(page.locator('h3:has-text("Sign In")')).toBeVisible({ timeout: DEFAULT_AUTH_TIMEOUT });
        await expect(page.locator('input#username')).toBeVisible();
        await expect(page.locator('input#password')).toBeVisible();
        await expect(page.locator('button:has-text("Sign in")')).toBeEnabled();
        await expect(page.locator('button:has-text("Continue as guest")')).toBeEnabled();
        await expect(page.locator('a:has-text("Sign up")')).toBeVisible();
        await expect(page.locator('a:has-text("Terms of Service")')).toBeVisible();
        await expect(page.locator('a:has-text("Github")')).toBeVisible();
    });

    test('should redirect to login if accessing protected route when logged out', async ({ page }) => {
        await page.goto('/#/doc/somefile'); // Try accessing a doc directly
        await page.waitForURL('**/#/login', { timeout: DEFAULT_AUTH_TIMEOUT }); // Should be redirected
        await expect(page.locator('h3:has-text("Sign In")')).toBeVisible({ timeout: DEFAULT_AUTH_TIMEOUT });
    });

    test('should allow continuing as guest', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('button:has-text("Continue as guest")')).toBeEnabled({ timeout: DEFAULT_AUTH_TIMEOUT });
        await page.locator('button:has-text("Continue as guest")').click();

        // Wait specifically for loading and then home URL
        await page.waitForURL('**/#/loading*', { timeout: DEFAULT_AUTH_TIMEOUT });
        await page.waitForURL('**/#/', { timeout: DEFAULT_AUTH_TIMEOUT });

        // Assert core elements are visible after guest login
        await expect(page.locator('nav button span:has-text("Format")')).toBeVisible({ timeout: DEFAULT_AUTH_TIMEOUT });
        await expect(page.locator('aside h2:has-text("Documents")')).toBeVisible({ timeout: DEFAULT_AUTH_TIMEOUT });

        // Check for guest user indication
        await expect(page.locator('.hidden.md\\:flex button:has-text("Logout")')).toBeVisible({ timeout: DEFAULT_AUTH_TIMEOUT });
        await expect(page.locator('.hidden.md\\:flex > div:not(:has(button)):not(:has(a))')).toContainText('Guest', { timeout: DEFAULT_AUTH_TIMEOUT }); // Check Guest text shown on desktop

        // Check default file content is loaded
        await expect(page.locator('textarea')).toHaveValue(/# Welcome to Markdown Editor/, { timeout: DEFAULT_AUTH_TIMEOUT });
        await expect(page.locator('div[role="treeitem"] span:has-text("Welcome.md")')).toBeVisible();
    });

    test('should navigate to signup page from login', async ({ page }) => {
        await page.goto('/#/login');
        await expect(page.locator('a:has-text("Sign up")')).toBeVisible();
        await page.locator('a:has-text("Sign up")').click();
        await page.waitForURL('**/#/signup');
        await expect(page.locator('h3:has-text("Sign Up")')).toBeVisible();
        await expect(page.locator('input#username')).toBeVisible();
        await expect(page.locator('input#password')).toBeVisible();
        await expect(page.locator('input#confirmPassword')).toBeVisible();
        await expect(page.locator('button:has-text("Create account")')).toBeDisabled(); // Should be disabled initially
        // Check if Turnstile container exists if key is set
        if (process.env.VITE_TURNSTILE_SITE_KEY) {
            // Use waitForSelector for elements potentially added dynamically
            await page.waitForSelector('#turnstile-container', { state: 'visible', timeout: 10000 });
        }
    });

    test('should navigate to terms page from login', async ({ page }) => {
        await page.goto('/#/login');
        await expect(page.locator('a:has-text("Terms of Service")')).toBeVisible();
        await page.locator('a:has-text("Terms of Service")').click();
        await page.waitForURL('**/#/terms');
        await expect(page.locator('h1:has-text("Terms of Service (ToS)")')).toBeVisible();
        await expect(page.locator('h2:has-text("1. Introduction")')).toBeVisible();
        await expect(page.locator('nav a:has-text("Back")')).toBeVisible(); // Back link on ToS page
    });

    test('should navigate back to login from terms page', async ({ page }) => {
        await page.goto('/#/terms');
        await expect(page.locator('nav a:has-text("Back")')).toBeVisible();
        await page.locator('nav a:has-text("Back")').click();
        await page.waitForURL('**/#/login');
        await expect(page.locator('h3:has-text("Sign In")')).toBeVisible();
    });

    test('should navigate back to login from signup page', async ({ page }) => {
        await page.goto('/#/signup');
        await expect(page.locator('a:has-text("Already have an account? Sign in")')).toBeVisible();
        await page.locator('a:has-text("Already have an account? Sign in")').click();
        await page.waitForURL('**/#/login');
        await expect(page.locator('h3:has-text("Sign In")')).toBeVisible();
    });

    test('Signup form validation', async ({ page }) => {
        await page.goto('/#/signup');
        await expect(page.locator('h3:has-text("Sign Up")')).toBeVisible();

        const usernameInput = page.locator('input#username');
        const passwordInput = page.locator('input#password');
        const confirmInput = page.locator('input#confirmPassword');
        const submitButton = page.locator('button:has-text("Create account")');

        await expect(submitButton).toBeDisabled();

        // Too short username
        await usernameInput.fill('us');
        await passwordInput.fill('password123');
        await confirmInput.fill('password123');
        await expect(page.locator('p:has-text("Username must be at least 3 characters")')).toBeVisible();
        await expect(submitButton).toBeDisabled();

        // Too short password
        await usernameInput.fill('userok');
        await passwordInput.fill('12345');
        await confirmInput.fill('12345');
        await expect(page.locator('p:has-text("Password must be at least 6 characters")')).toBeVisible();
        await expect(submitButton).toBeDisabled();

        // Passwords don't match
        await passwordInput.fill('password123');
        await confirmInput.fill('password456');
        await expect(page.locator('p:has-text("Passwords do not match")')).toBeVisible();
        await expect(submitButton).toBeDisabled();

        // Valid input - button enabled
        await confirmInput.fill('password123');
        await expect(page.locator('p:has-text("Username must be at least 3 characters")')).not.toBeVisible();
        await expect(page.locator('p:has-text("Password must be at least 6 characters")')).not.toBeVisible();
        await expect(page.locator('p:has-text("Passwords do not match")')).not.toBeVisible();
        await expect(submitButton).toBeEnabled();
    });

    // --- SKIPPED TESTS for actual Login/Signup ---
    test.skip('should signup a new user and login', async ({ page }) => {
        test.info().annotations.push({ type: 'info', description: 'Skipped: Requires backend signup service and CouchDB configured.' });
        // ... (keep existing skipped test logic)
    });

    test.skip('should login an existing user and logout', async ({ page }) => {
        test.info().annotations.push({ type: 'info', description: 'Skipped: Requires pre-existing user in backend CouchDB.' });
        // ... (use loginAsUser and logout helpers)
    });
    // --- END SKIPPED TESTS ---

    test('should logout when guest', async ({ page }) => {
        await loginAsGuest(page); // Helper handles setup and basic verification
        await expect(page.locator('.hidden.md\\:flex > div:not(:has(button)):not(:has(a))')).toContainText('Guest', { timeout: DEFAULT_AUTH_TIMEOUT });

        // Use the logout helper
        await logout(page);
        // Assertions are inside the logout helper
    });

});
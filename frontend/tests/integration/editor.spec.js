// frontend/tests/integration/editor.spec.js
import { test, expect } from '@playwright/test';
import { loginAsGuest, createFile, uniqueName } from './helpers'; // Use helpers

const EDITOR_DEBOUNCE_WAIT = 700; // Slightly longer than the 500ms debounce
const DEFAULT_EDITOR_TIMEOUT = 15000;

test.describe('Guest Mode - Editor and Preview', () => {
    let testFileName; // Store filename for use across tests if needed (or create in each)

    // Use beforeEach common setup: login and create a unique file for test isolation
    test.beforeEach(async ({ page }) => {
        testFileName = uniqueName('EditorTestFile');
        await loginAsGuest(page);
        await createFile(page, testFileName); // Use helper, this also selects the file
        await expect(page.locator('textarea')).toHaveValue('', { timeout: DEFAULT_EDITOR_TIMEOUT }); // Verify it's selected and empty
    });

    test('should update preview instantly on typing', async ({ page }) => {
        const editor = page.locator('textarea');
        const preview = page.locator('div.p-4 div[v-html]'); // More specific preview selector

        // Type basic markdown
        await editor.fill('# Hello World\n\nThis is **bold** text.');
        await page.waitForTimeout(100); // Small wait for reactive update

        // Preview should update immediately (uses draft store)
        await expect(preview.locator('h1')).toHaveText('Hello World', { timeout: DEFAULT_EDITOR_TIMEOUT });
        await expect(preview.locator('p > strong')).toHaveText('bold', { timeout: DEFAULT_EDITOR_TIMEOUT });
    });

    test('should update preview from draft store, save to DB on debounce', async ({ page }) => {
        const editor = page.locator('textarea');
        const preview = page.locator('div.p-4 div[v-html]');
        const initialText = '# Initial Content';
        const addedText = '\n\n* List item 1';

        await editor.fill(initialText);
        await expect(preview.locator('h1')).toHaveText('Initial Content', { timeout: DEFAULT_EDITOR_TIMEOUT });

        await editor.press('End'); // Go to end before typing more
        await editor.type(addedText);
        await expect(preview.locator('h1')).toHaveText('Initial Content', { timeout: DEFAULT_EDITOR_TIMEOUT }); // Still shows immediately
        await expect(preview.locator('ul > li')).toHaveText('List item 1', { timeout: DEFAULT_EDITOR_TIMEOUT });

        // Wait for debounce period
        await page.waitForTimeout(EDITOR_DEBOUNCE_WAIT);

        // Simulate reload requires re-login and re-selecting file in guest mode
        await page.reload();
        await loginAsGuest(page); // Re-login
        await page.locator(`div[role="treeitem"] span:has-text("${testFileName}")`).click(); // Re-select file
        await page.waitForURL(/\/doc\//, { timeout: DEFAULT_EDITOR_TIMEOUT }); // Wait for file URL

        // Verify the content was saved and loaded correctly
        await expect(editor).toHaveValue(initialText + addedText, { timeout: DEFAULT_EDITOR_TIMEOUT });
        await expect(preview.locator('h1')).toHaveText('Initial Content', { timeout: DEFAULT_EDITOR_TIMEOUT });
        await expect(preview.locator('ul > li')).toHaveText('List item 1', { timeout: DEFAULT_EDITOR_TIMEOUT });
    });

    async function openFormatSubmenu(page) {
        const formatButton = page.locator('nav button:has-text("Format")');
        // Click only if submenu not already visible
        // Check visibility of a known submenu item like 'Bold'
        const boldButton = page.locator('div.flex.flex-wrap.gap-2[key="tools"] div[title="Bold"]');
        if (!(await boldButton.isVisible())) {
            await formatButton.click();
        }
        await expect(boldButton).toBeVisible({ timeout: DEFAULT_EDITOR_TIMEOUT }); // Wait for submenu to be ready
    }

    test('should show/hide stats', async ({ page }) => {
        const editor = page.locator('textarea');
        const statsPanel = page.locator('div.flex.gap-4:has-text("Words:")'); // Selector for the stats container
        const statsToggle = page.locator('button span:has-text("Stats")'); // Submenu button

        await openFormatSubmenu(page);
        await expect(statsToggle).toBeVisible();

        // Stats initially hidden
        await expect(statsPanel).not.toBeVisible();

        // Click Stats button to show
        await statsToggle.click();
        await expect(statsPanel).toBeVisible({ timeout: DEFAULT_EDITOR_TIMEOUT });

        // Verify initial stats (empty file)
        await expect(statsPanel).toContainText('Words: 0');
        await expect(statsPanel).toContainText('Characters: 0');
        await expect(statsPanel).toContainText('Lines: 1'); // Empty textarea usually counts as 1 line

        // Add content
        await editor.fill('One two three.\nFour five.');
        // Expect stats to update automatically (might need small wait if updates are slow)
        await expect(statsPanel).toContainText('Words: 5', { timeout: 5000 }); // Wait a bit longer for stats calc
        await expect(statsPanel).toContainText('Characters: 24');
        await expect(statsPanel).toContainText('Lines: 2');

        // Click Stats button to hide
        await openFormatSubmenu(page); // Reopen if it closed
        await statsToggle.click();
        await expect(statsPanel).not.toBeVisible();
    });

    test('should show/hide metadata', async ({ page }) => {
        const metadataPanel = page.locator('div.text-sm.text-gray-600:has-text("Hash:")');
        const metadataToggle = page.locator('button span:has-text("Info")');

        await openFormatSubmenu(page);
        await expect(metadataToggle).toBeVisible();

        // Initially hidden
        await expect(metadataPanel).not.toBeVisible();

        // Click Info button to show
        await metadataToggle.click();
        await expect(metadataPanel).toBeVisible({ timeout: DEFAULT_EDITOR_TIMEOUT });

        // Check some metadata fields exist (values are dynamic)
        await expect(metadataPanel).toContainText(`Name: ${testFileName}`);
        await expect(metadataPanel).toContainText('Type: file');
        await expect(metadataPanel).toContainText('Hash:');
        await expect(metadataPanel).toContainText('TX:');

        // Click Info button to hide
        await openFormatSubmenu(page); // Reopen if it closed
        await metadataToggle.click();
        await expect(metadataPanel).not.toBeVisible();
    });

    test('should apply bold formatting using submenu', async ({ page }) => {
        const editor = page.locator('textarea');
        await editor.fill('Some text');
        await editor.selectText(); // Select "Some text"

        await openFormatSubmenu(page);
        const boldButton = page.locator('div.flex.flex-wrap.gap-2[key="tools"] div[title="Bold"]');
        await expect(boldButton).toBeVisible();
        await boldButton.click();

        await expect(editor).toHaveValue('**Some text**', { timeout: DEFAULT_EDITOR_TIMEOUT });
        await expect(page.locator('div.p-4 div[v-html] p strong')).toHaveText('Some text'); // Check preview
    });

    test('should apply italic formatting using submenu', async ({ page }) => {
        const editor = page.locator('textarea');
        await editor.fill('Some text');
        await editor.selectText();

        await openFormatSubmenu(page);
        const italicButton = page.locator('div.flex.flex-wrap.gap-2[key="tools"] div[title="Italic"]');
        await expect(italicButton).toBeVisible();
        await italicButton.click();

        await expect(editor).toHaveValue('_Some text_', { timeout: DEFAULT_EDITOR_TIMEOUT });
        await expect(page.locator('div.p-4 div[v-html] p em')).toHaveText('Some text'); // Check preview
    });

    test('should apply strikethrough formatting using submenu', async ({ page }) => {
        const editor = page.locator('textarea');
        await editor.fill('Some text');
        await editor.selectText();

        await openFormatSubmenu(page);
        const strikeButton = page.locator('div.flex.flex-wrap.gap-2[key="tools"] div[title="Strike"]');
        await expect(strikeButton).toBeVisible();
        await strikeButton.click();

        // Strikethrough often renders as <s> in HTML
        await expect(editor).toHaveValue('~~Some text~~', { timeout: DEFAULT_EDITOR_TIMEOUT });
        await expect(page.locator('div.p-4 div[v-html] p s')).toHaveText('Some text'); // Check preview
    });

    test('should insert bullet list prefix using submenu', async ({ page }) => {
        const editor = page.locator('textarea');
        await editor.fill('Item 1\nItem 2');

        // Place cursor at start of "Item 1"
        await editor.focus();
        await editor.selectText({ text: 'Item 1' }); // Select the first line
        // Alternative: Set cursor position precisely
        // await editor.evaluate(e => e.setSelectionRange(0, 0));

        await openFormatSubmenu(page);
        const bulletButton = page.locator('div.flex.flex-wrap.gap-2[key="tools"] div[title="Bullet List"]');
        await expect(bulletButton).toBeVisible();
        await bulletButton.click();

        // Result depends on whether it prefixes selection or just inserts at cursor
        // Assuming it prefixes the selected line or inserts at cursor start
        await expect(editor).toHaveValue('* Item 1\nItem 2', { timeout: DEFAULT_EDITOR_TIMEOUT });

        // Now try on the second line
        await editor.focus();
        await editor.press('ArrowDown'); // Move to second line
        await editor.press('Home');     // Go to start of second line
        await bulletButton.click();     // Click bullet again

        await expect(editor).toHaveValue('* Item 1\n* Item 2', { timeout: DEFAULT_EDITOR_TIMEOUT });
        await expect(page.locator('div.p-4 div[v-html] ul li').nth(0)).toHaveText('Item 1');
        await expect(page.locator('div.p-4 div[v-html] ul li').nth(1)).toHaveText('Item 2');
    });

    test('should insert table template using submenu', async ({ page }) => {
        const editor = page.locator('textarea');
        await editor.fill('Cursor position.');
        // Place cursor at the beginning
        await editor.focus();
        await editor.evaluate(e => e.setSelectionRange(0, 0)); // Set cursor to start

        await openFormatSubmenu(page);
        const tableButton = page.locator('button span:has-text("Table")');
        await expect(tableButton).toBeVisible();
        await tableButton.click();

        // Check if table markdown is inserted at the beginning
        const expectedTable = `
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
`
        await expect(editor).toHaveValue(expectedTable + 'Cursor position.', { timeout: DEFAULT_EDITOR_TIMEOUT });
        // Check preview for table elements
        await expect(page.locator('div.p-4 div[v-html] table th').first()).toHaveText('Header 1');
        await expect(page.locator('div.p-4 div[v-html] table td').first()).toHaveText('Cell 1');
    });

    test('should insert code block fences using submenu', async ({ page }) => {
        const editor = page.locator('textarea');
        await editor.fill('Some code here');
        await editor.selectText();

        await openFormatSubmenu(page);
        const codeBlockButton = page.locator('button span:has-text("Code")');
        await expect(codeBlockButton).toBeVisible();
        await codeBlockButton.click();

        await expect(editor).toHaveValue('```\nSome code here\n```', { timeout: DEFAULT_EDITOR_TIMEOUT });
        await expect(page.locator('div.p-4 div[v-html] pre code')).toContainText('Some code here'); // Check preview
    });

    test('should find text in editor using submenu search', async ({ page }) => {
        const editor = page.locator('textarea');
        const textToFind = 'instance';
        await editor.fill(`First ${textToFind} of text.\nSecond ${textToFind} of text.`);

        await openFormatSubmenu(page);
        const searchInput = page.locator('input[placeholder="Find text..."]');
        const findNextButton = page.locator('button span:has-text("Next")');

        await expect(searchInput).toBeVisible();
        await expect(findNextButton).toBeVisible();

        await searchInput.fill(textToFind);
        await findNextButton.click();

        // Check if first instance is selected using evaluation
        await expect(editor).toHaveJSProperty('selectionStart', 6); // Position of first 'instance'
        await expect(editor).toHaveJSProperty('selectionEnd', 6 + textToFind.length);

        // Find next
        await findNextButton.click();
        await expect(editor).toHaveJSProperty('selectionStart', 31); // Position of second 'instance'
        await expect(editor).toHaveJSProperty('selectionEnd', 31 + textToFind.length);

        // Find next again (should wrap around)
        await findNextButton.click();
        await expect(editor).toHaveJSProperty('selectionStart', 6); // Back to first 'instance'
        await expect(editor).toHaveJSProperty('selectionEnd', 6 + textToFind.length);
    });

    // Skipping image upload test - requires backend or complex mocking
    test.skip('should handle image paste and upload', async ({ page }) => {
        test.info().annotations.push({ type: 'info', description: 'Skipped: Requires running image service backend or complex paste event simulation.' });
        // ... (keep existing skipped test logic with mock setup) ...
    });

});
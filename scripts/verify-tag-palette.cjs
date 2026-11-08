#!/usr/bin/env node
/* global console, process */
/**
 * Verifies the tag palette (docs/specs/active/tag-system.md §4.2) against its
 * WCAG contrast, CIEDE2000 colour-distance and blue-hue-reservation thresholds.
 *
 * Usage: node scripts/verify-tag-palette.cjs
 * Exit code: 0 when every palette entry passes, 1 otherwise.
 */
async function main() {
    const { verifyTagPalette } = await import('../frontend/src/utils/tagPaletteVerify.js');
    const { TAG_PALETTE } = await import('../frontend/src/utils/tagPalette.js');

    const { violations } = verifyTagPalette();

    console.info(`Tag palette size: ${TAG_PALETTE.length}`);

    if (violations.length === 0) {
        console.info('PASS: every tag colour satisfies contrast, colour-distance and hue constraints.');
        return 0;
    }

    console.error('FAIL: tag palette violations found:');
    for (const violation of violations) {
        console.error(`  - ${violation}`);
    }
    return 1;
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });

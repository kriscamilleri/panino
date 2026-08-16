import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
    // Component tests mount real SFCs, so the Vue plugin and the `@` alias have
    // to be available to the test runner too. Files that need a DOM opt in with
    // a `// @vitest-environment jsdom` docblock; everything else stays on the
    // faster `node` environment.
    plugins: [vue()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
    }
});

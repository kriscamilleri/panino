import { configDefaults, defineConfig } from 'vitest/config';
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
        // tests/spike holds the throwaway experiments from before live sessions
        // were built. They duplicate the production binding, and one starts a
        // child process, kills it and waits five seconds. Run them on purpose
        // with `npx vitest run tests/spike --exclude ''`, not on every push.
        exclude: [...configDefaults.exclude, 'tests/spike/**'],
    }
});

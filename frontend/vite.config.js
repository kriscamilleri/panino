// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import copy from 'rollup-plugin-copy'

export default defineConfig({
  plugins: [
    vue(),
    copy({
      targets: [
        {
          // Updated path for the new PowerSync package
          src: 'node_modules/@journeyapps/wa-sqlite/dist/wa-sqlite-async.wasm',
          dest: 'public'
        }
      ],
      hook: 'buildStart'
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Add this alias to fix the lodash import issue
      'lodash': 'lodash-es'
    },
  },
  define: {
    global: 'globalThis'
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    // You may need to exclude the new packages from optimization
    exclude: ['@powersync/web'],
  },
  // Add base configuration for production
  base: '/',
  // Add worker configuration for PowerSync
  worker: {
    format: 'es'
  }
})
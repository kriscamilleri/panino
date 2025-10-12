// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import fs from 'fs'

export default defineConfig({
  plugins: [
    vue(),
    // Custom plugin to copy service worker in dev mode
    {
      name: 'copy-service-worker',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/service-worker.js') {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Service-Worker-Allowed', '/');
            const swContent = fs.readFileSync(
              path.resolve(__dirname, 'src/service-worker.js'),
              'utf-8'
            );
            res.end(swContent);
          } else {
            next();
          }
        });
      },
      // Copy service worker to dist during build
      closeBundle() {
        const swSource = path.resolve(__dirname, 'src/service-worker.js');
        const swDest = path.resolve(__dirname, 'dist/service-worker.js');
        if (fs.existsSync(swSource)) {
          fs.copyFileSync(swSource, swDest);
          console.log('✓ Service worker copied to dist/');
        }
      }
    }
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Required for cr-sqlite to use SharedArrayBuffer
  optimizeDeps: {
    exclude: ["@vlcn.io/crsqlite-wasm"]
  },
  server: {
    host: true, // For Docker
    port: 5173,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Service-Worker-Allowed": "/",
    },
  },
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  },
})
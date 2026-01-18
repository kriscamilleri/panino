// frontend/src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import AppShell from './AppShell.vue'
import './assets/main.css'
import { useUiStore } from '@/store/uiStore'
import { isTauriApp } from '@/utils/tauriWindow'

// Register Service Worker for PWA functionality
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js', { scope: '/' })
      .then((registration) => {
        console.log('[PWA] Service Worker registered:', registration.scope);
        
        // Check for updates periodically
        setInterval(() => {
          registration.update();
        }, 60000); // Check every minute
        
        // Listen for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available
              console.log('[PWA] New version available');
              const ui = useUiStore();
              ui.addToast('A new version is available. Refresh to update.', 'info', 10000);
            }
          });
        });
      })
      .catch((error) => {
        console.error('[PWA] Service Worker registration failed:', error);
      });
    
    // Listen for messages from service worker
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'BACKGROUND_SYNC') {
        console.log('[PWA] Background sync message received');
        // Trigger sync if applicable
        import('@/store/syncStore').then(({ useSyncStore }) => {
          const syncStore = useSyncStore();
          if (syncStore.syncEnabled && syncStore.isInitialized) {
            syncStore.sync();
          }
        });
      }
    });
  });
}

// Call the function
const app = createApp(AppShell)
const pinia = createPinia()

if (isTauriApp()) {
  document.documentElement.classList.add('tauri')
}

app.use(pinia)
app.use(router)

if (window.__TAURI__) {
  import('@/utils/tauriWindow')
    .then(async ({ getCurrentTauriWindow }) => {
      const tauriWindow = await getCurrentTauriWindow()
      if (!tauriWindow) return

      const root = document.documentElement
      const updateWindowRadius = async () => {
        try {
          const maximized = await tauriWindow.isMaximized()
          let fullscreen = false
          if (typeof tauriWindow.isFullscreen === 'function') {
            fullscreen = await tauriWindow.isFullscreen()
          }
          root.classList.toggle('window-maximized', maximized || fullscreen)
        } catch {
          root.classList.remove('window-maximized')
        }
      }

      await updateWindowRadius()

      if (typeof tauriWindow.onResized === 'function') {
        tauriWindow.onResized(() => {
          updateWindowRadius()
        })
      }
    })
    .catch(() => {})
}

// grab your UI store
const ui = useUiStore()

// override native alert
window.alert = (msg) => ui.addToast(String(msg))
// and register on each component as `this.$alert(...)`
app.config.globalProperties.$alert = window.alert

app.mount('#app')

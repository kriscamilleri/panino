// frontend/src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import AppShell from './AppShell.vue'
import './assets/main.css'
import { useUiStore } from '@/store/uiStore'
// Add this function to check for the WASM file
async function checkWasmFile() {
    const wasmUrl = '/wa-sqlite-async.wasm';
    try {
        const response = await fetch(wasmUrl, { method: 'HEAD' });
        if (response.ok) {
            console.log('✅ Success: wa-sqlite-async.wasm found at', wasmUrl);
        } else {
            console.error('❌ Error: wa-sqlite-async.wasm not found. The server responded with status:', response.status);
            console.error('Please ensure that `wa-sqlite-async.wasm` is placed in the `frontend/public` directory.');
        }
    } catch (error) {
        console.error('❌ Network Error: Could not check for wa-sqlite-async.wasm. This might be a CORS or network issue.', error);
    }
}

// Call the function
checkWasmFile();
const app = createApp(AppShell)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// grab your UI store
const ui = useUiStore()

// override native alert
window.alert = (msg) => ui.addToast(String(msg))
// and register on each component as `this.$alert(...)`
app.config.globalProperties.$alert = window.alert

app.mount('#app')

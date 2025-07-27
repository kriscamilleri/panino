// frontend/src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import AppShell from './AppShell.vue'
import './assets/main.css'
import { useUiStore } from '@/store/uiStore'
// Add this function to check for the WASM file


// Call the function
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

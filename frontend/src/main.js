import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import AppShell from './AppShell.vue'
import './assets/main.css'

// We no longer call docStore.initCouchDB() here. 
// Instead, the LoadingPage.vue will handle initial remote sync upon login.

const pinia = createPinia()
const app = createApp(AppShell)
app.use(pinia)
app.use(router)

app.mount('#app')

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import AppShell from './AppShell.vue'
import './assets/main.css'

// 1) Import the docStore
import { useDocStore } from '@/store/docStore'

const pinia = createPinia()
const app = createApp(AppShell)
app.use(pinia)
app.use(router)

// 2) Initialize the docStore *before* you mount the app
//    This ensures the data is loaded from local DB and
//    remote sync is started in every tab:
const docStore = useDocStore()
docStore.initCouchDB() // <---- The key!

app.mount('#app')
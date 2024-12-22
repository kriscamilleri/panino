import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import AppShell from './AppShell.vue' // your new root layout
import './assets/main.css'

createApp(AppShell)
    .use(createPinia())
    .use(router)
    .mount('#app')

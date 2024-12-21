import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/main.css' // This is where Tailwind is imported (see Tailwind docs)

const pinia = createPinia()

createApp(App)
    .use(pinia)
    .mount('#app')

// ----- START: src/router.js -----
import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import StylesPage from '@/pages/StylesPage.vue'

// We add a new route named 'doc' with a fileId param:
export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: '/',
            name: 'home',
            component: HomePage,
            meta: { keepAlive: true }
        },
        {
            path: '/doc/:fileId',
            name: 'doc',
            component: HomePage,
            meta: { keepAlive: true }
        },
        {
            path: '/styles',
            name: 'styles',
            component: StylesPage,
            meta: { keepAlive: true }
        }
    ]
})

// Add global navigation guard if you need it; for now it does nothing special.
router.beforeEach((to, from, next) => {
    next()
})
// ----- END: src/router.js -----

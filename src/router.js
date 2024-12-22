import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import StylesPage from '@/pages/StylesPage.vue'

export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: '/',
            name: 'home',
            component: HomePage,
            meta: { keepAlive: true }  // Add this
        },
        {
            path: '/styles',
            name: 'styles',
            component: StylesPage,
            meta: { keepAlive: true }  // Add this
        }
    ]
})

// Add global navigation guard
router.beforeEach((to, from, next) => {
    next()
})
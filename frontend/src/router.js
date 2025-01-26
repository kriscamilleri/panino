import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import StylesPage from '@/pages/StylesPage.vue'

// NEW imports:
import LoginForm from '@/components/LoginForm.vue'
import SignupForm from '@/components/SignupForm.vue'

// ADD this import:
import { useAuthStore } from '@/store/authStore.js'

// ADD PrintStylesPage import:
import PrintStylesPage from '@/pages/PrintStylesPage.vue'

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
        },
        // NEW route for Print Styles:
        {
            path: '/print-styles',
            name: 'print-styles',
            component: PrintStylesPage,
            meta: { keepAlive: true }
        },
        // NEW routes:
        {
            path: '/login',
            name: 'login',
            component: LoginForm,
        },
        {
            path: '/signup',
            name: 'signup',
            component: SignupForm,
        },
    ]
})

// AMENDED global navigation guard:
router.beforeEach(async (to, from, next) => {
    const authStore = useAuthStore()
    // Attempt to check if user is logged in (based on existing session cookie, if any)
    await authStore.checkAuth()

    // If NOT authenticated and trying to access anything except login/signup, redirect to login
    if (!authStore.isAuthenticated && to.name !== 'login' && to.name !== 'signup') {
        next({ name: 'login' })
    } else {
        next()
    }
})

import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import StylesPage from '@/pages/StylesPage.vue'
import LoginForm from '@/components/LoginForm.vue'
import SignupForm from '@/components/SignupForm.vue'
import LoadingPage from '@/pages/LoadingPage.vue'
import PrintStylesPage from '@/pages/PrintStylesPage.vue'
import TermsOfServicePage from '@/pages/TermsOfServicePage.vue' // <-- NEW import

import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'

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
    {
      path: '/print-styles',
      name: 'print-styles',
      component: PrintStylesPage,
      meta: { keepAlive: true }
    },
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
    {
      path: '/loading/:timestamp?',
      name: 'loading',
      component: LoadingPage
    },
    {
      path: '/terms',
      name: 'terms',
      component: TermsOfServicePage  // <-- NEW route
    }
  ]
})

// Global guard
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()
  const syncStore = useSyncStore()

  // Attempt to check if user is logged in
  await authStore.checkAuth()

  // If NOT authenticated and not guest, trying to access anything except login/signup/loading/terms => go login
  // Note: "Continue as guest" sets isAuthenticated=true anyway, so guests skip this block.
  if (!authStore.isAuthenticated && to.name !== 'login' && to.name !== 'signup' && to.name !== 'loading' && to.name !== 'terms') {
    return next({ name: 'login' })
  }

  // If authenticated, but local DB not initialized, let them go to /loading
  if (authStore.isAuthenticated && !syncStore.isInitialized) {
    if (to.name !== 'loading') {
      return next({
        name: 'loading',
        params: { timestamp: Date.now() }
      })
    }
  }

  next()
})

import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import StylesPage from '@/pages/StylesPage.vue'
import LoginForm from '@/components/LoginForm.vue'
import SignupForm from '@/components/SignupForm.vue'
import LoadingPage from '@/pages/LoadingPage.vue'
import PrintStylesPage from '@/pages/PrintStylesPage.vue'
import TermsOfServicePage from '@/pages/TermsOfServicePage.vue'

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
    // file route
    {
      path: '/doc/:fileId',
      name: 'doc',
      component: HomePage,
      props: true,
      meta: { keepAlive: true }
    },
    // folder route
    {
      path: '/folder/:folderId',
      name: 'folder',
      component: HomePage,
      props: true,
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
      component: TermsOfServicePage
    }
  ]
})

// Global guard
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()
  const syncStore = useSyncStore()

  // Attempt to check if user is logged in
  await authStore.checkAuth()

  // If NOT authenticated, redirect to login
  if (
    !authStore.isAuthenticated &&
    !['login','signup','loading','terms'].includes(to.name)
  ) {
    return next({ name: 'login' })
  }

  // If authenticated but local DB not initialized, go to loading
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

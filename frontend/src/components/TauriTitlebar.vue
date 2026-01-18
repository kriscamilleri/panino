<template>
  <div class="tauri-titlebar">
    <div class="tauri-titlebar__drag" data-tauri-drag-region>
      <span class="tauri-titlebar__title">Panino</span>
    </div>
    <div class="tauri-titlebar__controls" data-tauri-drag-region="false">
      <button
        class="tauri-titlebar__btn"
        type="button"
        aria-label="Minimize"
        data-tauri-drag-region="false"
        @click="handleMinimize"
      >
        <span aria-hidden="true">–</span>
      </button>
      <button
        class="tauri-titlebar__btn"
        type="button"
        :aria-label="maximized ? 'Restore' : 'Maximize'"
        data-tauri-drag-region="false"
        @click="handleToggleMaximize"
      >
        <span aria-hidden="true">{{ maximized ? '❐' : '□' }}</span>
      </button>
      <button
        class="tauri-titlebar__btn tauri-titlebar__btn--close"
        type="button"
        aria-label="Close"
        data-tauri-drag-region="false"
        @click="handleClose"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getCurrentTauriWindow } from '@/utils/tauriWindow'

const maximized = ref(false)
let tauriWindow = null
let unlisten = null

const syncMaximized = async () => {
  if (!tauriWindow) return
  try {
    maximized.value = await tauriWindow.isMaximized()
  } catch {
    maximized.value = false
  }
}

const handleMinimize = async () => {
  if (!tauriWindow) {
    console.warn('[TauriTitlebar] minimize clicked but no window instance')
    return
  }
  try {
    console.info('[TauriTitlebar] minimize clicked')
    await tauriWindow.minimize()
  } catch (error) {
    console.error('[TauriTitlebar] minimize failed', error)
  }
}

const handleToggleMaximize = async () => {
  if (!tauriWindow) {
    console.warn('[TauriTitlebar] maximize clicked but no window instance')
    return
  }
  try {
    console.info('[TauriTitlebar] toggle maximize clicked')
    await tauriWindow.toggleMaximize()
    await syncMaximized()
  } catch (error) {
    console.error('[TauriTitlebar] toggle maximize failed', error)
  }
}

const handleClose = async () => {
  if (!tauriWindow) {
    console.warn('[TauriTitlebar] close clicked but no window instance')
    return
  }
  try {
    console.info('[TauriTitlebar] close clicked')
    await tauriWindow.close()
  } catch (error) {
    console.error('[TauriTitlebar] close failed', error)
  }
}

onMounted(async () => {
  tauriWindow = await getCurrentTauriWindow()
  if (!tauriWindow) {
    console.warn('[TauriTitlebar] window instance unavailable', {
      hasTauri: !!window.__TAURI__,
      hasTauriInternals: !!window.__TAURI_INTERNALS__,
      tauriWindowGlobal: typeof window.__TAURI__?.window?.getCurrentWindow === 'function',
      tauriInternalsWindowGlobal: typeof window.__TAURI_INTERNALS__?.window?.getCurrentWindow === 'function'
    })
    return
  }

  console.info('[TauriTitlebar] window instance ready', {
    hasMinimize: typeof tauriWindow.minimize === 'function',
    hasToggleMaximize: typeof tauriWindow.toggleMaximize === 'function',
    hasClose: typeof tauriWindow.close === 'function',
    hasStartDragging: typeof tauriWindow.startDragging === 'function'
  })

  await syncMaximized()

  if (typeof tauriWindow.onResized === 'function') {
    unlisten = await tauriWindow.onResized(() => {
      syncMaximized()
    })
  }
})

onBeforeUnmount(() => {
  if (typeof unlisten === 'function') {
    unlisten()
  }
})
</script>
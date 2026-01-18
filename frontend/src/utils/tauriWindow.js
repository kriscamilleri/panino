export const isTauriApp = () => {
  if (typeof window === 'undefined') return false
  return !!window.__TAURI__ || !!window.__TAURI_INTERNALS__
}

export const getCurrentTauriWindow = async () => {
  if (!isTauriApp()) return null

  try {
    console.info('[tauriWindow] resolving current window', {
      hasTauri: !!window.__TAURI__,
      hasTauriInternals: !!window.__TAURI_INTERNALS__,
      tauriWindowGlobal: typeof window.__TAURI__?.window?.getCurrentWindow === 'function',
      tauriInternalsWindowGlobal: typeof window.__TAURI_INTERNALS__?.window?.getCurrentWindow === 'function'
    })

    if (window.__TAURI__?.window?.getCurrentWindow) {
      return window.__TAURI__.window.getCurrentWindow()
    }
    if (window.__TAURI_INTERNALS__?.window?.getCurrentWindow) {
      return window.__TAURI_INTERNALS__.window.getCurrentWindow()
    }
    const modulePath = '@tauri-apps/api/window'
    const { getCurrentWindow } = await import(/* @vite-ignore */ modulePath)
    return getCurrentWindow()
  } catch (error) {
    console.warn('[tauriWindow] getCurrentTauriWindow failed', error)
    return null
  }
}

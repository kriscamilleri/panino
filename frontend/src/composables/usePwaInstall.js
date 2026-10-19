import { computed, ref } from 'vue';

// One capture for the whole app: the banner and Settings both offer install.
const deferredPrompt = ref(null);
const installed = ref(false);
let listening = false;

function listen() {
    if (listening || typeof window === 'undefined') return;
    listening = true;
    installed.value = Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone);
    window.addEventListener('beforeinstallprompt', (event) => {
        // Keep the browser's mini-infobar away; install is offered in the app.
        event.preventDefault();
        deferredPrompt.value = event;
    });
    window.addEventListener('appinstalled', () => {
        installed.value = true;
        deferredPrompt.value = null;
    });
}

/**
 * Add-to-Home-Screen state. Browsers that never fire `beforeinstallprompt`
 * (iOS Safari) can still install from their share menu; `manualOnly` says so.
 */
export function usePwaInstall() {
    listen();
    const canPrompt = computed(() => Boolean(deferredPrompt.value));
    const manualOnly = computed(() => !installed.value && !deferredPrompt.value
        && /iphone|ipad|ipod/i.test(window.navigator.userAgent || ''));

    /** @returns {Promise<'accepted'|'dismissed'|'unavailable'>} */
    async function install() {
        const prompt = deferredPrompt.value;
        if (!prompt) return 'unavailable';
        prompt.prompt();
        const { outcome } = await prompt.userChoice;
        deferredPrompt.value = null;
        if (outcome === 'accepted') installed.value = true;
        return outcome;
    }

    return { canPrompt, installed, manualOnly, install };
}

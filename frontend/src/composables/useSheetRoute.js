import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/** Every sheet the phone UI can open, plus the Drawer. */
export const SHEETS = Object.freeze(['drawer', 'capture', 'menu', 'move', 'collaborate', 'export', 'sort']);

/**
 * Sheets live in the `?sheet=` query so the back gesture closes them before
 * it leaves the screen. Extra query values (`sheetArg`) carry what the sheet
 * acts on, such as the capture mode.
 */
export function useSheetRoute() {
    const route = useRoute();
    const router = useRouter();

    const activeSheet = computed(() => (SHEETS.includes(route.query.sheet) ? route.query.sheet : null));
    const sheetArg = computed(() => (typeof route.query.sheetArg === 'string' ? route.query.sheetArg : ''));

    /**
     * @param {string} name one of SHEETS
     * @param {string} [arg]
     */
    function openSheet(name, arg = '') {
        if (!SHEETS.includes(name)) throw new Error(`Unknown sheet ${name}`);
        const query = { ...route.query, sheet: name };
        if (arg) query.sheetArg = arg;
        else delete query.sheetArg;
        // A sheet opened from another sheet replaces it, so back returns to
        // the screen rather than to the sheet that is being left. It keeps
        // that sheet's origin: one that arrived in the URL was never pushed,
        // so closing must not go back past the screen.
        if (activeSheet.value) {
            return router.replace({ query, state: { pnSheet: Boolean(window.history.state?.pnSheet) } });
        }
        return router.push({ query, state: { pnSheet: true } });
    }

    /** Close the open sheet. Back when this session opened it, else drop the query. */
    function closeSheet() {
        if (!activeSheet.value) return Promise.resolve();
        if (window.history.state?.pnSheet && window.history.state?.back) {
            router.back();
            return Promise.resolve();
        }
        const query = { ...route.query };
        delete query.sheet;
        delete query.sheetArg;
        return router.replace({ query });
    }

    /**
     * Leave the sheet and go somewhere else in one history step, so back
     * from the new screen does not reopen the sheet.
     */
    function closeSheetAndGo(location) {
        return router.replace(location);
    }

    return { activeSheet, sheetArg, openSheet, closeSheet, closeSheetAndGo };
}

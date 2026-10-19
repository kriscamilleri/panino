/**
 * The phone back arrows mean "up": to the list a screen was opened from. A
 * browser back is only right when the previous history entry is such a list.
 * Otherwise (a styles page, Settings, a shared link) back would walk into a
 * screen the user did not come up from, and two screens could send each
 * other back and forth forever.
 */

const LIST_PATH = /^\/(?:$|\?|folder\/|folders(?:$|\?)|search(?:$|\?))/;

/**
 * Whether a router path is a list screen: Home (any filter), a folder, All
 * folders or Search.
 *
 * @param {unknown} path a vue-router path such as `history.state.back`
 * @returns {boolean}
 */
export function isListPath(path) {
    return typeof path === 'string' && LIST_PATH.test(path);
}

/**
 * Go up: back when the previous entry is a list, else replace this screen
 * with `fallback` so history does not grow a loop.
 *
 * @param {import('vue-router').Router} router
 * @param {import('vue-router').RouteLocationRaw} fallback
 */
export function goUp(router, fallback) {
    if (isListPath(window.history.state?.back)) router.back();
    else router.replace(fallback);
}

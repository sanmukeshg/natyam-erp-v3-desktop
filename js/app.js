/**
 * Natyam ERP v3 — Admin — Bootstrap
 *
 * Start-up order, each step depending on the last:
 *
 *   1. Paint the theme before anything else. Reading the preference from
 *      localStorage is synchronous, so the first frame is already correct;
 *      waiting on anything async here produces a flash of the wrong theme.
 *   2. Subscribe once to Firebase's onAuthStateChanged. Its callback,
 *      handleAuthStateChange(), is the single place that decides what a
 *      signed-in (or signed-out) Firebase user means for this app — it runs
 *      identically whether the user just restored a session on reload or
 *      just finished a fresh sign-in, so there is one path, not two that
 *      could drift apart.
 *   3. Once a Firebase user is authenticated *and* provisioned
 *      (resolveProvisionedUser, in auth.service.js) *and* holds a role this
 *      app serves, hydrate the session and mount the Shell and router.
 *
 * There is no local-database step here: v3 is Firestore-only, so nothing
 * needs opening or migrating before sign-in (v2's js/core/db.js is not part
 * of this app — see MIGRATION_CHECKLIST.md).
 *
 * Desktop serves Administrator, Owner & Accountant and Viewer. Teacher &
 * Reception is mobile-primary and is turned away here with an explanation,
 * the same shape as an inactive/archived rejection.
 */

import { session } from './core/session.js';
import { router } from './core/router.js';
import { bus, EVENTS } from './core/bus.js';
import { SESSION } from './config/app.config.js';
import { ROUTES } from './config/navigation.js';
import { Shell, applyTheme, applyDensity } from './ui/shell.js';
import { toast } from './ui/toast.js';
import { watchAuthState } from './core/firebase.js';
import { branches$ } from './data/repositories.js';
import { renderLogin } from './modules/auth/login.page.js';
import { pendingPage } from './modules/system/pending.page.js';
import { resolveProvisionedUser, expireSession, acknowledgeRemoteSignOut } from './services/auth.service.js';

/** Roles this app serves. Teacher & Reception belongs to natyam-mobile. */
const DESKTOP_ROLES = new Set(['administrator', 'owner_accountant', 'viewer']);

// A one-shot flag carried across the reload that follows an idle sign-out,
// so the login screen can explain why the person is looking at it.
const LOGOUT_REASON_KEY = 'natyam.logoutReason';

/** Set once the Shell/router/idle-timer are actually running. */
let appEntered = false;

/** A rejection message, threaded through to the next showLoginScreen() call. */
let pendingLoginMessage = null;

function boot() {
    const prefs = session.prefs();
    applyTheme(prefs.theme);
    applyDensity(prefs.density);

    watchAuthState(handleAuthStateChange);
}

async function handleAuthStateChange(firebaseUser) {
    if (!firebaseUser) {
        if (appEntered) {
            // Another tab signed out (or this one hit an idle timeout that
            // already ran expireSession()) — either way Firebase now reports
            // signed-out here too. Best-effort close this tab's own Firestore
            // session record before the reload tears everything else down.
            acknowledgeRemoteSignOut().catch(() => {});
            location.reload();
            return;
        }
        session.destroySession();
        showLoginScreen();
        return;
    }

    try {
        const user = await resolveProvisionedUser(firebaseUser);

        if (!DESKTOP_ROLES.has(user.role)) {
            pendingLoginMessage =
                'This account uses the Natyam ERP mobile app, not the desktop app. Open the mobile app to sign in.';
            await expireSession().catch(() => {});
            return;
        }

        await hydrateSession(user);
        appEntered = true;
        enterApp();
    } catch (err) {
        // Not provisioned, inactive, or archived. Sign the Firebase user back
        // out — that re-fires this function with null, which shows the login
        // screen again; this is what it reads to explain why.
        pendingLoginMessage = err.message;
        await expireSession().catch(() => {});
    }
}

/**
 * The login screen renders before the router (and the Shell it depends on)
 * ever mounts — there is nothing to protect yet, so nothing for the router
 * to gate.
 */
function showLoginScreen() {
    document.querySelector('#boot')?.remove();

    const message = pendingLoginMessage;
    pendingLoginMessage = null;
    renderLogin(document.querySelector('#app'), { initialError: message });

    const reason = sessionStorage.getItem(LOGOUT_REASON_KEY);
    if (reason) {
        sessionStorage.removeItem(LOGOUT_REASON_KEY);
        if (reason === 'idle') toast.info('Signed out', 'You were signed out after a period of inactivity.');
    }
}

function enterApp() {
    const root = document.querySelector('#app');
    const shell = new Shell(root);
    const viewport = shell.mount();

    registerRoutes();
    router.mount(viewport).start();

    document.querySelector('#boot')?.remove();
    bus.emit(EVENTS.APP_READY);

    // Preferences can change on any screen; the shell is the only thing that
    // needs to react, so it is handled once here rather than in every page.
    bus.on(EVENTS.PREFS_CHANGED, ({ key, value }) => {
        if (key === 'theme') applyTheme(value);
        if (key === 'density') applyDensity(value);
    });

    watchIdleSession();
}

function registerRoutes() {
    for (const route of ROUTES) {
        // A route whose module has not been migrated yet still resolves — to
        // an honest placeholder rather than a failed import. See
        // js/modules/system/pending.page.js.
        const load = route.load || (async () => ({ default: pendingPage(route.label) }));

        router.register(route.path, { load, cap: route.cap, title: route.label });

        // Detail routes are registered alongside their list route so a page
        // can own both /students and /students/:id from one config entry.
        //
        // The root route is excluded deliberately: appending '/:id' to '/'
        // produces '/:id', a single-segment catch-all matching every
        // top-level path. Registered first, it would silently route every
        // screen to the dashboard.
        if (route.detail !== false && route.path !== '/') {
            router.register(`${route.path}/:id`, { load, cap: route.cap, title: route.label });
        }
    }
}

/**
 * Idle timeout. Real activity renews the session (`session.touch()`); a
 * periodic check notices once it has lapsed and ends it via Firebase
 * sign-out — handleAuthStateChange() picks that up and reloads.
 */
function watchIdleSession() {
    let lastTouch = 0;
    const markActivity = () => {
        const now = Date.now();
        if (now - lastTouch < 15000) return;   // at most one write per ~15s
        lastTouch = now;
        session.touch();
    };
    ['click', 'keydown', 'mousemove', 'scroll'].forEach((type) =>
        window.addEventListener(type, markActivity, { passive: true }));

    setInterval(() => {
        if (session.isIdleFor(SESSION.idleTimeoutMs)) {
            sessionStorage.setItem(LOGOUT_REASON_KEY, 'idle');
            expireSession().catch((err) => console.error('Idle sign-out failed', err));
        }
    }, 60000);
}

/**
 * @param {object} user  The provisioned Firestore user record (see auth.service.js).
 */
async function hydrateSession(user) {
    // Isolated from resolveProvisionedUser()'s own failure mode on purpose.
    // The caller's catch treats any error as "not provisioned, inactive, or
    // archived" and signs the person back out — correct for a real
    // provisioning rejection, wrong for a branches read that merely failed.
    // `user` is already known-good here; the person should see the app,
    // degraded, and be told what happened.
    let branches = [];
    try {
        branches = await branches$.active();
    } catch (err) {
        console.error('Could not load branches at sign-in', err);
        toast.error(`Could not load your branches — ${err.message}. Reload to try again.`);
    }

    // session.hydrate remembers the previously selected branch itself, so no
    // branch id is passed — passing one would override the user's choice on
    // every reload.
    session.hydrate({ user, branches, activeBranchId: null });
}

/* Unhandled failures anywhere in the app surface as a toast rather than a
   silent console entry nobody in a dance school will ever open. */
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection', event.reason);
    toast?.error?.(event.reason?.message || 'Something failed unexpectedly.');
});

boot();

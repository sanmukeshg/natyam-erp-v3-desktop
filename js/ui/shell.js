/**
 * Natyam ERP v3 — Admin — Application shell
 *
 * The chrome around every page, rebuilt for v3 from the approved design
 * project ("Sidebar Navigation.dc.html", plus the shell visible in
 * "Dashboard.dc.html"). What changed from v2's shell, and why:
 *
 *   - Navigation is an **accordion**. Only one group (Overview / People /
 *     Teaching / Money / Insight) is expanded at a time, and the group
 *     containing the current route opens automatically. Opening Money no
 *     longer pushes Insight off the bottom of the screen.
 *   - The sidebar collapses to a **64px icon rail** instead of disappearing.
 *     In rail mode every group shows its icons, because a collapsed group
 *     with no visible label would otherwise be unreachable.
 *   - **Jump search** filters the nav by name. In v2 this button opened the
 *     Ctrl-K command palette; the design specifies an in-sidebar filter
 *     ("filters straight to any page by name"), so that is what it does.
 *     The palette is a separate concern and is not part of this app yet.
 *
 * Same five groups, same routes, same capability gating as before — this
 * changes how much of the list is visible at once, not the structure or the
 * permissions on it. Navigation comes from js/config/navigation.js (this
 * app's own table), never from a shared array.
 *
 * The header keeps the design's shape (search left, identity right). The
 * branch switcher, notification bell, theme toggle and sign-out are not
 * drawn in the design mockups — which model a screen, not a working
 * session — so they are added here in the same visual language rather than
 * dropped, since the app genuinely needs them.
 *
 * As in v2, the shell listens on the bus rather than being poked by pages: a
 * shell that every page must remember to notify is a shell that breaks each
 * time a page is added.
 */

import { html, render, raw, on, el, initials } from '../utils/dom.js';
import { icon } from './icons.js';
import { session } from '../core/session.js';
import { bus, EVENTS } from '../core/bus.js';
import { router } from '../core/router.js';
import { NAVIGATION } from '../config/navigation.js';
import { unreadCount } from '../services/notifications.service.js';
import { logout } from '../services/auth.service.js';

export class Shell {
    constructor(root) {
        this.root = root;
        this.railCollapsed = session.prefs().sidebar === 'collapsed';
        // Which accordion group is open. Resolved against the current route
        // at mount, so the shell opens where the user actually is.
        this.openGroup = null;
        this.filter = '';
    }

    mount() {
        this.openGroup = this.groupForPath(router.path()) || NAVIGATION[0]?.group || null;

        render(this.root, html`
            <a class="skip-link" href="#main">Skip to content</a>

            <div class="v3-shell" data-role="shell" data-rail="${this.railCollapsed ? 'collapsed' : 'expanded'}">

                <aside class="v3-sidebar">
                    <div class="v3-brand">
                        <span class="v3-brand-mark" aria-hidden="true">
                            <!-- The 192 rather than the 48: this renders at 30 CSS px,
                                 which is 60 device px on a retina screen, so the small
                                 favicon would arrive visibly soft. -->
                            <img src="assets/icons/icon-192.png" alt="">
                        </span>
                        <span class="v3-brand-text">
                            <span class="v3-brand-name">NATYAM</span>
                            <span class="v3-brand-sub">School of Kuchipudi</span>
                        </span>
                        <!--
                            UAT BUG-207. The glyph follows the state: pointing
                            left it offers to collapse, pointing right it offers
                            to expand. It used to point left in both states, so
                            once collapsed it read as "collapse further" — the
                            aria-label already flipped, the icon did not.
                        -->
                        <button class="v3-rail-toggle" data-action="rail"
                                aria-label="${this.railCollapsed ? 'Expand navigation' : 'Collapse navigation to icons'}">
                            ${raw(icon(this.railCollapsed ? 'chevrons-right' : 'chevrons-left', { size: 14 }))}
                        </button>
                    </div>

                    <div class="v3-jump">
                        <label class="v3-jump-btn">
                            ${raw(icon('search', { size: 13 }))}
                            <span class="sr-only">Jump to a page</span>
                            <input type="search" data-role="jump" placeholder="Jump to…"
                                   style="flex:1;min-width:0;background:none;border:none;outline:none;color:inherit;font:inherit;">
                        </label>
                    </div>

                    <nav class="v3-nav" aria-label="Main">
                        <div data-role="nav"></div>
                    </nav>
                </aside>

                <div class="v3-main">
                    <header class="v3-header">
                        <div class="v3-header-search">
                            <button class="v3-search-btn" data-action="search">
                                ${raw(icon('search', { size: 15 }))}
                                <span>Search students, receipts, batches…</span>
                            </button>
                        </div>

                        <div class="v3-header-actions">
                            <div data-role="branch"></div>

                            <a class="v3-header-btn" href="#/notifications" data-role="bell" aria-label="Notifications">
                                ${raw(icon('bell', { size: 17 }))}
                            </a>

                            <button class="v3-header-btn" data-action="theme"
                                    aria-label="Switch between light and dark">
                                ${raw(icon('moon', { size: 17 }))}
                            </button>

                            <button class="v3-header-btn" data-action="logout" aria-label="Sign out">
                                ${raw(icon('log-out', { size: 17 }))}
                            </button>

                            <button class="v3-profile-btn" data-action="profile">
                                <span class="v3-avatar" aria-hidden="true" data-role="avatar"></span>
                                <span>
                                    <span class="v3-profile-name" data-role="user-name"></span>
                                    <span class="v3-profile-role" data-role="user-role"></span>
                                </span>
                            </button>
                        </div>
                    </header>

                    <!--
                      Shown by CSS only under 620px (see v3.css). This is the
                      desktop app; phones have natyam-mobile, with a bottom tab
                      bar. Owner & Accountant can sign in to either, so landing
                      here on a phone is a real possibility worth naming rather
                      than serving a squeezed desktop layout in silence.

                      Deliberately a sibling of the viewport, not a child of it:
                      the router renders each page into the viewport by replacing
                      its contents, so anything placed inside would survive
                      exactly until the first navigation.
                    -->
                    <div class="v3-small-screen-note" role="note">
                        <strong>This is the desktop app.</strong>
                        <span>On a phone, use the Natyam ERP mobile app instead — it is built for
                        touch, with a bottom navigation bar. You can carry on here if you need to.</span>
                    </div>

                    <main class="v3-viewport" id="main" data-role="viewport" tabindex="-1"></main>
                </div>
            </div>
        `);

        this.paintNav();
        this.paintRailToggle();
        this.paintBranch();
        this.paintUser();
        this.bind();
        this.refreshBell();

        return this.root.querySelector('[data-role="viewport"]');
    }

    /* ------------------------------------------------------------------ NAV */

    /** Groups this session may see at all, with capability-hidden items removed. */
    visibleGroups() {
        const term = this.filter.trim().toLowerCase();

        return NAVIGATION
            .map((group) => ({
                ...group,
                items: group.items.filter((item) =>
                    !item.hidden
                    && (!item.cap || session.can(item.cap))
                    && (!term || item.label.toLowerCase().includes(term)))
            }))
            .filter((group) => group.items.length);
    }

    /** The group a path belongs to, for auto-opening the right accordion section. */
    groupForPath(path) {
        for (const group of NAVIGATION) {
            for (const item of group.items) {
                const match = item.path === '/'
                    ? path === '/'
                    : path === item.path || path.startsWith(`${item.path}/`);
                if (match) return group.group;
            }
        }
        return null;
    }

    /**
     * Points the toggle at what it will do next: left to collapse, right to
     * expand. Called on mount and on every toggle, so the glyph, the accessible
     * name and the actual state can never disagree.
     */
    paintRailToggle(button = this.root.querySelector('[data-action="rail"]')) {
        if (!button) return;
        button.setAttribute('aria-label',
            this.railCollapsed ? 'Expand navigation' : 'Collapse navigation to icons');
        button.innerHTML = icon(this.railCollapsed ? 'chevrons-right' : 'chevrons-left', { size: 14 });
    }

    paintNav() {
        const groups = this.visibleGroups();
        // While filtering, every matching group opens — the point of the
        // filter is to see the matches, not to hunt for which section hides them.
        const filtering = Boolean(this.filter.trim());

        render(this.root.querySelector('[data-role="nav"]'), html`
            ${groups.map((group) => html`
                <div class="v3-nav-group" data-group="${group.group}"
                     data-open="${filtering || group.group === this.openGroup ? 'true' : 'false'}">
                    <button class="v3-nav-group-btn" data-action="group" data-group="${group.group}"
                            aria-expanded="${filtering || group.group === this.openGroup ? 'true' : 'false'}">
                        ${raw(icon(group.icon, { size: 16 }))}
                        <span class="v3-nav-group-label">${group.group}</span>
                        <span class="v3-nav-chevron">${raw(icon('chevron-down', { size: 12 }))}</span>
                    </button>
                    <ul class="v3-nav-list">
                        ${group.items.map((item) => html`
                            <li>
                                <a class="v3-nav-item" href="#${item.path}" data-path="${item.path}"
                                   data-pending="${item.load ? 'false' : 'true'}"
                                   title="${item.load ? item.label : `${item.label} — not migrated yet`}">
                                    ${raw(icon(item.icon, { size: 18 }))}
                                    <span class="v3-nav-item-label">${item.label}</span>
                                </a>
                            </li>
                        `)}
                    </ul>
                </div>
            `)}
            ${groups.length ? '' : html`<div class="v3-empty">No page matches that.</div>`}
        `);

        this.markActive();
    }

    /**
     * Highlights the current route, matching on prefix so /students/:id still
     * lights up Students. `aria-current` is what the stylesheet keys on, which
     * makes the visual state and the accessible state impossible to separate.
     */
    markActive() {
        const current = router.path();

        this.root.querySelectorAll('[data-path]').forEach((node) => {
            const path = node.dataset.path;
            const active = path === '/'
                ? current === '/'
                : current === path || current.startsWith(`${path}/`);

            if (active) node.setAttribute('aria-current', 'page');
            else node.removeAttribute('aria-current');
        });
    }

    /* --------------------------------------------------------------- BRANCH */

    paintBranch() {
        const branches = session.branches || [];
        const target = this.root.querySelector('[data-role="branch"]');

        // Shown whenever the school has a branch at all — even with no choice
        // to make, it states which branch you are working in.
        if (!branches.length) {
            render(target, '');
            return;
        }

        render(target, html`
            <label>
                <span class="sr-only">Active branch</span>
                <select class="v3-branch-select" data-role="branch-select">
                    ${session.canAny('settings.view', 'report.view') ? html`
                        <option value="" ${session.branch() === null ? 'selected' : ''}>All branches</option>
                    ` : ''}
                    ${branches.map((branch) => html`
                        <option value="${branch.id}" ${session.branch() === branch.id ? 'selected' : ''}>
                            ${branch.name}
                        </option>
                    `)}
                </select>
            </label>
        `);
    }

    paintUser() {
        const name = session.actorName();
        render(this.root.querySelector('[data-role="user-name"]'), name);
        render(this.root.querySelector('[data-role="user-role"]'), session.roleLabel());
        render(this.root.querySelector('[data-role="avatar"]'), initials(name));
    }

    /* ----------------------------------------------------------------- BELL */

    async refreshBell() {
        try {
            const count = await unreadCount();
            const bell = this.root.querySelector('[data-role="bell"]');
            if (!bell) return;

            bell.setAttribute('aria-label', count ? `Notifications, ${count} unread` : 'Notifications');

            const existing = bell.querySelector('.v3-badge-count');
            if (count) {
                const text = count > 9 ? '9+' : String(count);
                if (existing) existing.textContent = text;
                else bell.append(el('span', { class: 'v3-badge-count' }, text));
            } else {
                existing?.remove();
            }
        } catch {
            /* The bell is decoration. A failure here must not break the shell. */
        }
    }

    /* ---------------------------------------------------------------- EVENTS */

    bind() {
        on(this.root, 'click', '[data-action="group"]', (_e, target) => {
            const group = target.dataset.group;
            this.openGroup = this.openGroup === group ? null : group;
            this.paintNav();
        });

        on(this.root, 'click', '[data-action="rail"]', (_e, target) => {
            this.railCollapsed = !this.railCollapsed;
            this.root.querySelector('[data-role="shell"]')
                .setAttribute('data-rail', this.railCollapsed ? 'collapsed' : 'expanded');
            session.setPref('sidebar', this.railCollapsed ? 'collapsed' : 'expanded');

            // The button is rendered once by mount(), so its glyph and label
            // have to be refreshed here or they keep describing the state the
            // sidebar was in when the shell was built (UAT BUG-207).
            this.paintRailToggle(target);
        });

        on(this.root, 'input', '[data-role="jump"]', (_e, target) => {
            this.filter = target.value;
            this.paintNav();
            // paintNav() replaced the input; put the caret back where it was.
            const field = this.root.querySelector('[data-role="jump"]');
            if (field && document.activeElement !== field) {
                field.value = this.filter;
                field.focus();
                field.setSelectionRange(field.value.length, field.value.length);
            }
        });

        // A pending module has no page to open — say so rather than
        // navigating to a route that cannot resolve.
        on(this.root, 'click', '.v3-nav-item[data-pending="true"]', (event) => {
            event.preventDefault();
        });

        on(this.root, 'click', '[data-action="search"]', () => {
            this.root.querySelector('[data-role="jump"]')?.focus();
        });

        on(this.root, 'click', '[data-action="profile"]', () => router.go('/profile'));

        on(this.root, 'click', '[data-action="theme"]', () => {
            const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            session.setPref('theme', next);
        });

        on(this.root, 'click', '[data-action="logout"]', () => {
            // Firebase's own auth-state change (not this handler) is what
            // returns to the login screen — see app.js's handleAuthStateChange().
            logout().catch((err) => console.error('Sign out failed', err));
        });

        on(this.root, 'change', '[data-role="branch-select"]', (_e, target) => {
            session.setBranch(target.value || null);
        });

        bus.on(EVENTS.ROUTE_DONE, () => {
            // Follow the user: opening a page in a collapsed group expands it.
            const group = this.groupForPath(router.path());
            if (group && group !== this.openGroup) {
                this.openGroup = group;
                this.paintNav();
            } else {
                this.markActive();
            }
            this.root.querySelector('[data-role="viewport"]')?.focus?.();
        });

        bus.on(EVENTS.BRANCH_CHANGED, () => this.paintBranch());

        [EVENTS.NOTIFICATION_ADDED, EVENTS.NOTIFICATION_READ, EVENTS.PAYMENT_RECORDED]
            .forEach((event) => bus.on(event, () => this.refreshBell()));
    }
}

/* ------------------------------------------------------------------ THEME */

/**
 * Applied to <html> so the first paint is already correct. "system" follows
 * the device and keeps following it, which matters for a school that starts
 * before dawn and finishes after dark.
 */
export function applyTheme(preference) {
    const resolved = preference === 'system'
        ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : preference;

    document.documentElement.dataset.theme = resolved || 'light';
    bus.emit(EVENTS.THEME_CHANGED, { theme: resolved });
}

export function applyDensity(density) {
    document.documentElement.dataset.density = density || 'comfortable';
}

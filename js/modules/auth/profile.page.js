/**
 * Natyam ERP v3 — Admin — My account
 *
 * NO APPROVED v3 DESIGN EXISTS FOR THIS SCREEN — never part of the Claude
 * Design project (see docs/design/README.md). Built from the v3 system.
 *
 * Four things a person needs about their own account: who the school thinks
 * they are, what they are allowed to do, how they get in, and the two display
 * preferences that follow them around.
 *
 * **`js/ui/form.js` is deliberately not used here.** The reference version of
 * this page opens its password dialog through `formOverlay()`, a 548-line v2
 * component library styled entirely against `components.css` — which this app
 * has never loaded, because no migrated screen has needed it. Pulling both in
 * for one two-field form would drag v2's whole opaque-surface component system
 * into an app built on the v3 glass system, for a dialog that is a label, two
 * inputs and a button. It is written natively instead.
 *
 * The only write on this page is `setOwnPassword()`, and it is deliberately
 * self-scoped: the service takes no user id, so this screen cannot be turned
 * into a way to set somebody else's password. That constraint lives in
 * auth.service.js and is left exactly where it is.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on, formData, initials } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS, bus } from '../../core/bus.js';
import { formatDateLong } from '../../utils/date.js';
import { roleLabel, roleCapabilities, PREFERENCE_DEFAULTS } from '../../config/app.config.js';
import { users$, authMethodsOf } from '../../data/repositories.js';
import { setOwnPassword } from '../../services/auth.service.js';

/** How each sign-in method is described to a person who is not an administrator. */
const METHOD_LABEL = {
    google: { label: 'Google', icon: 'user', note: 'Sign in with your Google account.' },
    password: { label: 'Email & password', icon: 'lock', note: 'Sign in with your email address and a password.' },
    mobile: { label: 'Mobile OTP', icon: 'phone', note: 'Sign in with a code sent to your mobile.' }
};

const THEMES = [
    { value: 'system', label: 'Match my device' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
];

const DENSITIES = [
    { value: 'compact', label: 'Compact' },
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'spacious', label: 'Spacious' }
];

export default class ProfilePage extends Page {
    constructor(context) {
        super(context);
        this.title = 'My account';
        this.account = null;
        this.passwordOpen = false;
        this.busy = false;
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head">
                <h1 class="v3-page-title">My account</h1>
                <p class="v3-page-sub">${session.actorName()} · ${session.roleLabel()}</p>
            </div>
            <div class="v3-page-body" data-role="body">
                <div class="v3-skeleton">Loading your account…</div>
            </div>
        `);

        this.bind();
        await this.load();
    }

    async load() {
        try {
            // The session holds a snapshot from sign-in; this re-reads the
            // record so a role or method changed by an administrator since
            // then is reflected rather than quietly stale.
            this.account = await users$.find(session.actorId());
            if (this.disposed) return;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Account failed to load', err);
            // The session already knows enough to render most of this page, so
            // a failed read degrades rather than blanks it.
            this.account = null;
            this.paint(err.message);
        }
    }

    paint(loadError = null) {
        const account = this.account;
        const prefs = session.prefs();
        const methods = account ? authMethodsOf(account) : [];
        const caps = roleCapabilities(session.role()) || [];

        render(this.container.querySelector('[data-role="body"]'), html`
            ${loadError ? html`
                <div class="v3-notice" data-tone="caution">
                    Your full account record could not be loaded (${loadError}). What is shown
                    below comes from this session.
                </div>
            ` : ''}

            <section class="v3-card">
                <div class="v3-card-head"><h2 class="v3-card-title">Who you are</h2></div>
                <div class="v3-card-body v3-identity">
                    <span class="v3-identity-avatar">${initials(session.actorName())}</span>
                    <dl class="v3-facts" style="flex:1;">
                        ${fact('Name', account?.name || session.actorName())}
                        ${fact('Email', account?.email || '—')}
                        ${fact('Mobile', account?.mobile || '—')}
                        ${fact('Role', roleLabel(session.role()) || session.roleLabel())}
                        ${fact('Status', account?.status ? titleCase(account.status) : '—')}
                        ${account?.createdAt ? fact('Member since', formatDateLong(account.createdAt)) : ''}
                    </dl>
                </div>
            </section>

            <section class="v3-card">
                <div class="v3-card-head">
                    <h2 class="v3-card-title">How you sign in</h2>
                    <p class="v3-card-note">
                        Which methods are permitted is set by an administrator — it is not a
                        role, and it is not something this screen can change.
                    </p>
                </div>
                <div class="v3-list">
                    ${methods.length ? methods.map((m) => {
                        const meta = METHOD_LABEL[m] || { label: m, icon: 'lock', note: '' };
                        return html`
                            <div class="v3-row">
                                <span class="v3-note-icon" data-severity="success">
                                    ${raw(icon(meta.icon, { size: 16 }))}
                                </span>
                                <div class="v3-row-main">
                                    <div class="v3-row-title">${meta.label}</div>
                                    <div class="v3-row-detail">${meta.note}</div>
                                </div>
                                ${m === 'password' ? html`
                                    <button class="v3-ghost-btn" data-action="password">Change password</button>
                                ` : ''}
                            </div>
                        `;
                    }) : html`<div class="v3-empty">No sign-in method is recorded on your account.</div>`}
                </div>

                ${!methods.includes('password') ? html`
                    <div class="v3-card-body">
                        <div class="v3-notice" data-tone="info">
                            You sign in without a password today. You can add one for your own
                            account — it does not replace your existing method.
                        </div>
                        <button class="v3-action-btn v3-btn-md" data-action="password" style="margin-top:10px;">
                            ${raw(icon('lock', { size: 14 }))} Set a password
                        </button>
                    </div>
                ` : ''}

                ${this.passwordOpen ? html`
                    <form class="v3-pay" data-role="password-form">
                        <div class="v3-pay-grid">
                            <label class="v3-field">
                                <span>New password</span>
                                <input class="v3-input" type="password" name="password" required
                                       minlength="8" autocomplete="new-password">
                            </label>
                            <label class="v3-field">
                                <span>Repeat it</span>
                                <input class="v3-input" type="password" name="confirm" required
                                       minlength="8" autocomplete="new-password">
                            </label>
                        </div>
                        <div class="v3-pay-foot">
                            <span class="v3-row-detail">At least 8 characters.</span>
                            <span class="v3-head-actions">
                                <button class="v3-ghost-btn v3-btn-md" type="button" data-action="cancel-password">Cancel</button>
                                <button class="v3-action-btn v3-btn-md" type="submit" ${this.busy ? 'disabled' : ''}>
                                    ${this.busy ? 'Saving…' : 'Save password'}
                                </button>
                            </span>
                        </div>
                    </form>
                ` : ''}
            </section>

            <section class="v3-card">
                <div class="v3-card-head">
                    <h2 class="v3-card-title">What you can do</h2>
                    <p class="v3-card-note">
                        ${caps.length} permission${caps.length === 1 ? '' : 's'} from the
                        ${roleLabel(session.role()) || 'your'} role. Roles are set by an administrator.
                    </p>
                </div>
                <div class="v3-card-body">
                    ${caps.length ? html`
                        <div class="v3-chips">
                            ${caps.map((c) => html`<span class="v3-chip">${c}</span>`)}
                        </div>
                    ` : html`<p class="v3-modal-note">No permissions are attached to this role.</p>`}
                </div>
            </section>

            <section class="v3-card">
                <div class="v3-card-head">
                    <h2 class="v3-card-title">Display</h2>
                    <p class="v3-card-note">Saved to this browser, and applied straight away.</p>
                </div>
                <div class="v3-card-body">
                    <div class="v3-pay-grid">
                        <label class="v3-field">
                            <span>Appearance</span>
                            <select class="v3-input" data-role="theme">
                                ${THEMES.map((t) => html`
                                    <option value="${t.value}" ${(prefs.theme || PREFERENCE_DEFAULTS.theme) === t.value ? 'selected' : ''}>
                                        ${t.label}
                                    </option>
                                `)}
                            </select>
                        </label>
                        <label class="v3-field">
                            <span>Density</span>
                            <select class="v3-input" data-role="density">
                                ${DENSITIES.map((d) => html`
                                    <option value="${d.value}" ${(prefs.density || PREFERENCE_DEFAULTS.density) === d.value ? 'selected' : ''}>
                                        ${d.label}
                                    </option>
                                `)}
                            </select>
                        </label>
                    </div>
                </div>
            </section>
        `);
    }

    async savePassword(form) {
        if (this.busy) return;
        const { password, confirm } = formData(form);

        if (password !== confirm) {
            toast.error('Those two passwords do not match.');
            return;
        }

        this.busy = true;
        this.paint();

        try {
            await setOwnPassword(password);
            toast.success('Password saved', 'You can now sign in with your email and this password.');
            this.busy = false;
            this.passwordOpen = false;
            await this.load();
        } catch (err) {
            this.busy = false;
            if (this.disposed) return;
            toast.error(err.message);
            this.paint();
        }
    }

    bind() {
        const root = this.container;

        this.onDispose(on(root, 'click', '[data-action="password"]', () => {
            this.passwordOpen = true;
            this.paint();
            root.querySelector('[name="password"]')?.focus();
        }));

        this.onDispose(on(root, 'click', '[data-action="cancel-password"]', () => {
            this.passwordOpen = false;
            this.paint();
        }));

        this.onDispose(on(root, 'submit', '[data-role="password-form"]', (event, form) => {
            event.preventDefault();
            this.savePassword(form);
        }));

        // Preferences apply immediately. app.js listens for PREFS_CHANGED and
        // re-applies the theme/density to <html>, so this page does not touch
        // the document itself.
        this.onDispose(on(root, 'change', '[data-role="theme"]', (_e, t) => {
            session.setPref('theme', t.value);
            bus.emit(EVENTS.PREFS_CHANGED, { key: 'theme', value: t.value });
        }));

        this.onDispose(on(root, 'change', '[data-role="density"]', (_e, t) => {
            session.setPref('density', t.value);
            bus.emit(EVENTS.PREFS_CHANGED, { key: 'density', value: t.value });
        }));
    }
}

/* ------------------------------------------------------------------ HELPERS */

function fact(label, value) {
    return html`<div class="v3-fact"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function titleCase(value) {
    return String(value || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

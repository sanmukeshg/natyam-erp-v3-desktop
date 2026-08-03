/**
 * Natyam ERP v3 — Admin — Settings
 *
 * `Settings.dc.html` was lost with the design project (see
 * docs/design/README.md), but its structure survived in the project's own
 * change log and is honoured here:
 *
 *   > "Built Settings module (Settings.dc.html): tabbed Institute/Branches/
 *   >  Fee plans/Curriculum/Users/Roles/Preferences/Audit log/Data,
 *   >  role-gated (Teacher hides Users/Audit log/Data per the real capability
 *   >  model)"
 *
 * All nine tabs, in that order, with the same gating — and the gating is the
 * real one: each tab names a CAPABILITIES string and `visibleTabs()` filters
 * on `session.can()`, exactly as the reference page does. Teacher & Reception
 * genuinely lacks USER_VIEW, AUDIT_VIEW and the backup/export/restore trio, so
 * those three tabs are absent for them without this page special-casing a role
 * anywhere.
 *
 * WHAT IS AND IS NOT WIRED. This screen reads everything, and writes:
 * Preferences, Edit the school, Add branch, Add fee plan, Add academic year,
 * Add curriculum/programme-type/expense-category entry, and Add user — all
 * through js/ui/form.js.
 *
 * ADD, NOT EDIT, on the lists. Renaming, reordering and deactivating a
 * master-set entry are the operations that carry risk: `masterEntryUsage()`
 * exists precisely so an entry already in use cannot be quietly removed, and
 * doing it properly needs a list editor with a usage check per row rather than
 * a one-field dialog. Adding is separable and safe, so it ships now instead of
 * waiting behind that. Same for records — `updateFeePlan()` reports back how
 * many students are affected going forward, and that answer deserves to be
 * shown, not swallowed.
 *
 * THE USER FORM AND THE GUARDRAIL. `requireRoleAssignable()` in the service
 * refuses to let anyone without `role.manage` create an Administrator —
 * otherwise every Administrator-only capability would be one click from
 * self-granted. This page does NOT reimplement that rule. It only declines to
 * *offer* a choice the caller cannot make, so an Owner never picks
 * Administrator and then gets refused. The service still decides, and
 * firestore.rules decides again server-side.
 *
 * Remaining unwired buttons stay present and disabled with an explanation.
 * `cardHead()` renders wired and unwired sections identically apart from the
 * one thing that differs — whether the button can be pressed.
 *
 * THE DATA TAB — settled in Stage 26 as **Option B**: Firestore-era backups
 * only. v3's `backup.service.js` is a rewrite with no IndexedDB path at all, so
 * a pre-v3 file is described and refused by name rather than half-restored.
 * The open question carried since Stage 0 is closed.
 *
 * The three controls there are deliberately unequal. Taking a backup is a plain
 * action. Restoring sits behind a file picker, so nothing is offered until a
 * real file has been read and described — the decision is made against the
 * file's contents, not its name. Erasing is last, and both it and restore
 * confirm against a **typed phrase**, because a single click should not be able
 * to replace or delete every record in the project and "are you sure?" stopped
 * being read years ago.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS, bus } from '../../core/bus.js';
import { formatDateTime, formatDateLong } from '../../utils/date.js';
import { formatMoney, formatNumber } from '../../utils/money.js';
import { CAPABILITIES, PREFERENCE_DEFAULTS, exposedFeeFrequencies, SCHEMA } from '../../config/app.config.js';
import {
    institute, listBranches, listFeePlans, listMasterSet, MASTER_SETS,
    listUsers, roleMatrix, listAcademicYears,
    createBranch, createFeePlan, createAcademicYear,
    updateInstitute, addMasterEntry, createUser
} from '../../services/settings.service.js';
import { search as searchAudit } from '../../services/audit.service.js';
import {
    backupStatus, downloadBackup, exportStore, inspectBackup, restore, resetEverything
} from '../../services/backup.service.js';
import { formModal, confirmModal } from '../../ui/form.js';

/** Same nine tabs, same order, same gating as the reference page. */
const TABS = [
    { key: 'institute', label: 'Institute', cap: null },
    { key: 'branches', label: 'Branches', cap: null },
    { key: 'fees', label: 'Fee plans', cap: null },
    { key: 'curriculum', label: 'Curriculum', cap: null },
    { key: 'users', label: 'Users', cap: CAPABILITIES.USER_VIEW },
    { key: 'roles', label: 'Roles', cap: null },
    { key: 'preferences', label: 'Preferences', cap: null },
    { key: 'audit', label: 'Audit log', cap: CAPABILITIES.AUDIT_VIEW },
    { key: 'data', label: 'Data',
      cap: [CAPABILITIES.BACKUP_CREATE, CAPABILITIES.DATA_EXPORT, CAPABILITIES.DATA_RESTORE] }
];

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

const NOT_WIRED = 'Editing arrives with the settings form layer — see MIGRATION_CHECKLIST.md.';

export default class SettingsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Settings';
        this.tab = this.query.tab || null;
        this.data = {};
        this.loading = false;
    }

    /** Tabs this caller can actually open. An array `cap` means "any of these". */
    visibleTabs() {
        return TABS.filter((tab) => {
            if (!tab.cap) return true;
            return Array.isArray(tab.cap) ? session.canAny(...tab.cap) : session.can(tab.cap);
        });
    }

    async render(container) {
        this.container = container;

        const tabs = this.visibleTabs();
        if (!this.tab || !tabs.some((t) => t.key === this.tab)) this.tab = tabs[0]?.key || null;

        render(container, html`
            <div class="v3-page-head">
                <h1 class="v3-page-title">Settings</h1>
                <p class="v3-page-sub">
                    ${tabs.length} of ${TABS.length} sections available to ${session.roleLabel()}
                </p>
            </div>
            <div class="v3-page-body">
                <div class="v3-tabs v3-tabs-page" role="tablist" data-role="tabs">
                    ${tabs.map((t) => html`
                        <button class="v3-tab" data-action="tab" data-tab="${t.key}" role="tab"
                                aria-selected="${this.tab === t.key ? 'true' : 'false'}">${t.label}</button>
                    `)}
                </div>
                <div data-role="panel"><div class="v3-skeleton">Loading…</div></div>
            </div>
        `);

        this.bind();
        await this.loadTab();
    }

    async loadTab() {
        const panel = this.container.querySelector('[data-role="panel"]');
        this.loading = true;
        render(panel, html`<div class="v3-skeleton">Loading ${this.tab}…</div>`);

        try {
            // Each tab fetches only what it shows — Settings is the one screen
            // where loading everything up front would be a genuinely wasteful
            // read burst across nine collections.
            if (this.tab === 'institute' && !this.data.institute) {
                this.data.institute = await institute();
                this.data.years = await listAcademicYears().catch(() => []);
            } else if (this.tab === 'branches' && !this.data.branches) {
                this.data.branches = await listBranches({ includeInactive: true });
            } else if (this.tab === 'fees' && !this.data.feePlans) {
                this.data.feePlans = await listFeePlans({ includeInactive: true });
            } else if (this.tab === 'curriculum' && !this.data.master) {
                const sets = Object.keys(MASTER_SETS);
                const lists = await Promise.all(sets.map((s) => listMasterSet(s)));
                this.data.master = sets.map((s, i) => ({ set: s, meta: MASTER_SETS[s], entries: lists[i] }));
            } else if (this.tab === 'users' && !this.data.users) {
                this.data.users = await listUsers();
            } else if (this.tab === 'roles' && !this.data.roles) {
                this.data.roles = roleMatrix();
            } else if (this.tab === 'audit' && !this.data.audit) {
                this.data.audit = await searchAudit({ limit: 60 });
            } else if (this.tab === 'data' && !this.data.backupStatus) {
                // A read of every collection, so it is done once per visit and
                // cached — not on every repaint of the panel.
                this.data.backupStatus = await backupStatus();
            }
            if (this.disposed) return;
            this.loading = false;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            this.loading = false;
            console.error(`Settings tab "${this.tab}" failed`, err);
            render(panel, html`<div class="v3-error">This section could not be loaded — ${err.message}</div>`);
        }
    }

    paint() {
        const panel = this.container.querySelector('[data-role="panel"]');
        this.container.querySelectorAll('[data-action="tab"]').forEach((node) => {
            node.setAttribute('aria-selected', node.dataset.tab === this.tab ? 'true' : 'false');
        });
        render(panel, this.panelFor(this.tab));
    }

    panelFor(tab) {
        switch (tab) {
            case 'institute':   return this.institutePanel();
            case 'branches':    return this.branchesPanel();
            case 'fees':        return this.feePlansPanel();
            case 'curriculum':  return this.curriculumPanel();
            case 'users':       return this.usersPanel();
            case 'roles':       return this.rolesPanel();
            case 'preferences': return this.preferencesPanel();
            case 'audit':       return this.auditPanel();
            case 'data':        return this.dataPanel();
            default:            return html`<div class="v3-empty">Nothing to show.</div>`;
        }
    }

    /* ------------------------------------------------------------- PANELS */

    institutePanel() {
        const i = this.data.institute || {};
        const years = this.data.years || [];
        const current = years.find((y) => y.current) || null;

        return html`
            <section class="v3-card">
                ${cardHead('The school', 'Shown on receipts, certificates and reports.', 'Edit institute', 'edit-institute')}
                <div class="v3-card-body">
                    <dl class="v3-facts">
                        ${fact('Name', i.name || '—')}
                        ${fact('Legal name', i.legalName || '—')}
                        ${fact('Address', i.address || '—')}
                        ${fact('Phone', i.phone || '—')}
                        ${fact('Email', i.email || '—')}
                        ${fact('Website', i.website || '—')}
                        ${fact('GSTIN', i.gstin || '—')}
                    </dl>
                </div>
            </section>

            <section class="v3-card">
                ${cardHead('Academic years', 'The year new admissions and invoices are stamped with.', 'Add year', 'add-year')}
                ${years.length ? html`
                    <div class="v3-list">
                        ${years.map((y) => html`
                            <div class="v3-row">
                                <div class="v3-row-main">
                                    <div class="v3-row-title">${y.label || y.id}</div>
                                    <div class="v3-row-detail">
                                        ${y.startDate ? formatDateLong(y.startDate) : '—'} – ${y.endDate ? formatDateLong(y.endDate) : '—'}
                                    </div>
                                </div>
                                ${y.current ? html`<span class="v3-chip" data-fee="clear">Current</span>` : ''}
                            </div>
                        `)}
                    </div>
                ` : html`<div class="v3-empty">No academic year has been set up.</div>`}
                ${current ? '' : html`
                    <div class="v3-card-body">
                        <div class="v3-notice" data-tone="caution">
                            No year is marked current — new admissions and invoices have nothing to stamp.
                        </div>
                    </div>
                `}
            </section>
        `;
    }

    branchesPanel() {
        const rows = this.data.branches || [];
        return html`
            <section class="v3-card">
                ${cardHead('Branches', `${rows.length} branch${rows.length === 1 ? '' : 'es'}.`, 'Add branch', 'add-branch')}
                ${rows.length ? html`
                    <div class="v3-list">
                        ${rows.map((b) => html`
                            <div class="v3-row">
                                <div class="v3-row-main">
                                    <div class="v3-row-title">${b.name}${b.code ? ` · ${b.code}` : ''}</div>
                                    <div class="v3-row-detail">${b.address || 'No address'}${b.phone ? ` · ${b.phone}` : ''}</div>
                                </div>
                                <span class="v3-chip" data-fee="${b.status === 'active' ? 'clear' : ''}">
                                    ${titleCase(b.status || 'active')}
                                </span>
                            </div>
                        `)}
                    </div>
                ` : html`<div class="v3-empty">No branches yet.</div>`}
            </section>
        `;
    }

    feePlansPanel() {
        const rows = this.data.feePlans || [];
        return html`
            <section class="v3-card">
                ${cardHead('Fee plans', 'What a student is billed, and how often.', 'Add plan', 'add-plan')}
                ${rows.length ? html`
                    <div class="v3-list">
                        ${rows.map((p) => html`
                            <div class="v3-row">
                                <div class="v3-row-main">
                                    <div class="v3-row-title">${p.name}</div>
                                    <div class="v3-row-detail">
                                        ${p.frequency ? titleCase(p.frequency) : '—'}${p.level ? ` · ${p.level}` : ''}
                                    </div>
                                </div>
                                <span class="v3-chip">${formatMoney(p.amount || 0)}</span>
                                <span class="v3-chip" data-fee="${p.status === 'active' ? 'clear' : ''}">
                                    ${titleCase(p.status || 'active')}
                                </span>
                            </div>
                        `)}
                    </div>
                ` : html`<div class="v3-empty">No fee plans yet.</div>`}
            </section>
        `;
    }

    curriculumPanel() {
        const sets = this.data.master || [];
        return html`
            ${sets.map(({ set, meta, entries }) => html`
                <section class="v3-card">
                    ${cardHead(meta.label, `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`, 'Add entry', `add-entry:${set}`)}
                    ${entries.length ? html`
                        <div class="v3-list">
                            ${entries.map((e) => html`
                                <div class="v3-row">
                                    <span class="v3-roll-index">${e.order}</span>
                                    <div class="v3-row-main">
                                        <div class="v3-row-title">${e.label}</div>
                                        ${e.description ? html`<div class="v3-row-detail">${e.description}</div>` : ''}
                                    </div>
                                    <span class="v3-chip" data-fee="${e.status === 'active' ? 'clear' : ''}">
                                        ${titleCase(e.status || 'active')}
                                    </span>
                                </div>
                            `)}
                        </div>
                    ` : html`<div class="v3-empty">Using the shipped defaults.</div>`}
                </section>
            `)}
        `;
    }

    usersPanel() {
        const rows = this.data.users || [];
        return html`
            <section class="v3-card">
                ${cardHead('Users', `${rows.length} account${rows.length === 1 ? '' : 's'}. Only an Administrator can grant the Administrator role.`, 'Add user', 'add-user')}
                ${rows.length ? html`
                    <div class="v3-list">
                        ${rows.map((u) => html`
                            <div class="v3-row">
                                <span class="v3-note-icon" data-severity="${u.status === 'active' ? 'success' : 'info'}">
                                    ${raw(icon('user', { size: 16 }))}
                                </span>
                                <div class="v3-row-main">
                                    <div class="v3-row-title">${u.name}</div>
                                    <div class="v3-row-detail">
                                        ${u.email || u.mobile || '—'} · ${(u.authMethods || []).join(', ') || 'no sign-in method'}
                                    </div>
                                </div>
                                <span class="v3-chip">${u.roleLabel}</span>
                                <span class="v3-chip" data-fee="${u.status === 'active' ? 'clear' : 'overdue'}">
                                    ${titleCase(u.status || 'active')}
                                </span>
                            </div>
                        `)}
                    </div>
                ` : html`<div class="v3-empty">No users.</div>`}
            </section>
        `;
    }

    /**
     * The role × capability matrix. Read-only by nature — it is a statement of
     * what the app enforces, not a form. Administrator-only capabilities are
     * marked, because that reservation is the thing stopping an Owner from
     * self-granting everything.
     */
    rolesPanel() {
        const m = this.data.roles;
        if (!m) return html`<div class="v3-empty">No role matrix.</div>`;

        return html`
            <section class="v3-card">
                ${cardHead('Roles', 'What each role may do. Enforced in the app and again in Firestore rules.')}
                <div class="v3-matrix-wrap">
                    <table class="v3-matrix">
                        <thead>
                            <tr>
                                <th scope="col">Capability</th>
                                ${m.roles.map((r) => html`<th scope="col">${r.label}</th>`)}
                            </tr>
                        </thead>
                        <tbody>
                            ${m.capabilities.map((c) => html`
                                <tr>
                                    <th scope="row">
                                        ${c.label}
                                        ${c.administratorOnly ? html`<span class="v3-chip" style="margin-left:6px;">admin only</span>` : ''}
                                    </th>
                                    ${m.roles.map((r) => html`
                                        <td data-granted="${r.grants[c.key] ? 'true' : 'false'}">
                                            ${r.grants[c.key] ? raw(icon('check', { size: 14 })) : ''}
                                        </td>
                                    `)}
                                </tr>
                            `)}
                        </tbody>
                    </table>
                </div>
            </section>
        `;
    }

    preferencesPanel() {
        const prefs = session.prefs();
        return html`
            <section class="v3-card">
                ${cardHead('Display', 'Saved to this browser only, and applied straight away.')}
                <div class="v3-card-body">
                    <div class="v3-pay-grid">
                        <label class="v3-field">
                            <span>Appearance</span>
                            <select class="v3-input" data-role="theme">
                                ${THEMES.map((t) => html`
                                    <option value="${t.value}" ${(prefs.theme || PREFERENCE_DEFAULTS.theme) === t.value ? 'selected' : ''}>${t.label}</option>
                                `)}
                            </select>
                        </label>
                        <label class="v3-field">
                            <span>Density</span>
                            <select class="v3-input" data-role="density">
                                ${DENSITIES.map((d) => html`
                                    <option value="${d.value}" ${(prefs.density || PREFERENCE_DEFAULTS.density) === d.value ? 'selected' : ''}>${d.label}</option>
                                `)}
                            </select>
                        </label>
                    </div>
                    <p class="v3-modal-note" style="margin-top:12px;">
                        These are the only settings this screen currently writes.
                    </p>
                </div>
            </section>
        `;
    }

    auditPanel() {
        const rows = this.data.audit || [];
        return html`
            <section class="v3-card">
                ${cardHead('Audit log', `The last ${rows.length} recorded actions. Who changed what, and when.`)}
                ${rows.length ? html`
                    <div class="v3-list">
                        ${rows.map((row) => html`
                            <div class="v3-row">
                                <span class="v3-dot"></span>
                                <div class="v3-row-main">
                                    <div class="v3-row-title">${row.summary || `${row.action} ${row.entity}`}</div>
                                    <div class="v3-row-detail">
                                        ${row.actorName || 'System'}${row.at ? ` · ${formatDateTime(row.at)}` : ''}
                                    </div>
                                </div>
                                ${row.entityLabel ? html`<span class="v3-chip">${row.entityLabel}</span>` : ''}
                            </div>
                        `)}
                    </div>
                ` : html`<div class="v3-empty">Nothing recorded yet.</div>`}
            </section>
        `;
    }

    /**
     * Backup, restore, export and erase.
     *
     * OPTION B, chosen explicitly: Firestore-era backups only. The service has
     * no IndexedDB path at all, so a pre-v3 file is refused by name with the
     * reason rather than half-restored — see backup.service.js's header.
     *
     * The three destructive controls are deliberately not equal-weight. Taking
     * a backup is a plain action. Restoring is behind a file picker, so nothing
     * happens until a real file has been read and described. Erasing sits at
     * the bottom, styled as the exception it is, and both of those confirm
     * against a typed phrase rather than a single click.
     */
    dataPanel() {
        const s = this.data.backupStatus;

        return html`
            <section class="v3-card">
                ${cardHead('Backup', 'Everything the school holds, as one file.')}
                <div class="v3-card-body">
                    ${s ? html`
                        <dl class="v3-facts">
                            ${fact('Records', formatNumber(s.totalRecords))}
                            ${fact('Collections with data', formatNumber(s.sections.length))}
                            ${fact('Largest', s.sections[0]
                                ? `${s.sections[0][0]} — ${formatNumber(s.sections[0][1])}`
                                : '—')}
                        </dl>
                    ` : html`<div class="v3-skeleton">Counting records…</div>`}
                    <p class="v3-modal-note">
                        The file records the app version, the schema version, when it was taken and
                        by whom — so a future restore can tell whether it understands the file
                        before it starts overwriting anything. Accounts are included, but restoring
                        them is a separate choice.
                    </p>
                    <div class="v3-ops">
                        ${session.can(CAPABILITIES.BACKUP_CREATE) ? html`
                            <button class="v3-action-btn v3-btn-sm" data-action="take-backup">
                                Download a backup
                            </button>
                        ` : ''}
                        ${session.can(CAPABILITIES.DATA_EXPORT) ? html`
                            <button class="v3-ghost-btn v3-btn-sm" data-action="export-one">
                                Export one collection
                            </button>
                        ` : ''}
                    </div>
                </div>
            </section>

            ${session.can(CAPABILITIES.DATA_RESTORE) ? html`
                <section class="v3-card">
                    ${cardHead('Restore', 'Replaces what is here with the contents of a backup file.')}
                    <div class="v3-card-body">
                        <div class="v3-notice" data-tone="caution">
                            A safety copy of the current data downloads first, automatically.
                            Backups taken before v3 cannot be read — v3 keeps everything in
                            Firestore and has no local store to restore them into.
                        </div>
                        <input type="file" accept="application/json,.json" data-role="restore-file"
                               class="v3-input" style="margin-top:12px;">
                        <div data-role="restore-preview"></div>
                    </div>
                </section>

                <section class="v3-card" data-danger>
                    ${cardHead('Erase everything', 'Empties every collection in this Firebase project.')}
                    <div class="v3-card-body">
                        <p class="v3-modal-note">
                            For clearing demo data before entering the school's own. The institute
                            record and branches are kept, because retyping them buys no safety.
                            A safety copy downloads first.
                        </p>
                        <button class="v3-ghost-btn v3-btn-sm" data-action="erase-all">
                            Erase all data
                        </button>
                    </div>
                </section>
            ` : ''}
        `;
    }

    /* --------------------------------------------------------------- EVENTS */

    bind() {
        const root = this.container;

        this.onDispose(on(root, 'click', '[data-action="tab"]', (_e, t) => {
            if (this.tab === t.dataset.tab) return;
            this.tab = t.dataset.tab;
            this.loadTab();
        }));

        this.onDispose(on(root, 'change', '[data-role="theme"]', (_e, t) => {
            session.setPref('theme', t.value);
            bus.emit(EVENTS.PREFS_CHANGED, { key: 'theme', value: t.value });
        }));

        this.onDispose(on(root, 'change', '[data-role="density"]', (_e, t) => {
            session.setPref('density', t.value);
            bus.emit(EVENTS.PREFS_CHANGED, { key: 'density', value: t.value });
        }));

        this.onDispose(on(root, 'click', '[data-action="not-wired"]', () =>
            toast.info('Not available yet', NOT_WIRED)));

        this.onDispose(on(root, 'click', '[data-action="add-branch"]', () => this.addBranch()));
        this.onDispose(on(root, 'click', '[data-action="add-plan"]', () => this.addFeePlan()));
        this.onDispose(on(root, 'click', '[data-action="add-year"]', () => this.addYear()));
        this.onDispose(on(root, 'click', '[data-action="edit-institute"]', () => this.editInstitute()));
        this.onDispose(on(root, 'click', '[data-action="take-backup"]', () => this.takeBackup()));
        this.onDispose(on(root, 'click', '[data-action="export-one"]', () => this.exportOne()));
        this.onDispose(on(root, 'click', '[data-action="erase-all"]', () => this.eraseAll()));
        this.onDispose(on(root, 'change', '[data-role="restore-file"]', (_e, t) =>
            this.previewRestore(t.files?.[0] || null)));
        this.onDispose(on(root, 'click', '[data-action="do-restore"]', () => this.doRestore()));
        this.onDispose(on(root, 'click', '[data-action="add-user"]', () => this.addUser()));
        this.onDispose(on(root, 'click', '[data-action^="add-entry:"]', (_e, t) =>
            this.addMasterEntry(t.dataset.action.split(':')[1])));
    }

    /* --------------------------------------------------------------- FORMS */

    /**
     * Each of these declares only what the form can judge instantly. The
     * service owns the rest and its errors surface inside the form — so a
     * duplicate branch code, or an academic year overlapping an existing one,
     * is reported without the person losing what they typed. See
     * js/ui/form.js's header for that contract.
     */
    async addBranch() {
        const created = await formModal({
            title: 'Add a branch',
            description: 'A branch scopes students, batches, fees and reports.',
            submitLabel: 'Add branch',
            fields: [
                { name: 'name', label: 'Branch name', required: true, placeholder: 'Natyam — Kondapur' },
                { name: 'code', label: 'Short code', required: true, maxLength: 10,
                  placeholder: 'KDP', help: 'Used on receipts and admission numbers. Saved in capitals.' },
                { name: 'address', label: 'Address', type: 'textarea' },
                { name: 'phone', label: 'Phone', placeholder: '+91…' },
                { name: 'email', label: 'Email', type: 'text' }
            ],
            onSubmit: (values) => createBranch(values)
        });

        if (!created) return;
        toast.success('Branch added', created.name);
        this.data.branches = null;
        await this.loadTab();
    }

    async addFeePlan() {
        const created = await formModal({
            title: 'Add a fee plan',
            description: 'What a student on this plan is billed, and how often.',
            submitLabel: 'Add plan',
            fields: [
                { name: 'name', label: 'Plan name', required: true, placeholder: 'Junior Batch' },
                { name: 'amount', label: 'Fee', type: 'money', required: true, min: 1,
                  help: 'The amount charged each period, in whole rupees.' },
                { name: 'frequency', label: 'Charged', type: 'select', required: true,
                  options: exposedFeeFrequencies().map((f) => ({ value: f.value, label: f.label })) },
                { name: 'registrationFee', label: 'One-off registration fee', type: 'money', min: 0 },
                { name: 'costumeFee', label: 'One-off costume fee', type: 'money', min: 0 }
            ],
            values: { frequency: 'monthly', registrationFee: 0, costumeFee: 0 },
            onSubmit: (values) => createFeePlan(values)
        });

        if (!created) return;
        toast.success('Fee plan added', created.name);
        this.data.feePlans = null;
        await this.loadTab();
    }

    async addYear() {
        const created = await formModal({
            title: 'Add an academic year',
            description: 'New admissions and invoices are stamped with the current year.',
            submitLabel: 'Add year',
            fields: [
                { name: 'label', label: 'Name', required: true, placeholder: '2026–27' },
                { name: 'startsOn', label: 'Starts on', type: 'date', required: true },
                { name: 'endsOn', label: 'Ends on', type: 'date', required: true,
                  // Checked here as well as in the service purely so the person
                  // sees it before a round trip — the service still decides.
                  validate: (value, all) =>
                      all.startsOn && value <= all.startsOn ? 'The year cannot end before it starts.' : null },
                { name: 'makeCurrent', label: 'Make this the current year', type: 'switch',
                  switchLabel: 'Yes, stamp new records with it',
                  help: 'Exactly one year is current; the service swaps it atomically.' }
            ],
            onSubmit: (values) => createAcademicYear(values)
        });

        if (!created) return;
        toast.success('Academic year added', created.label);
        this.data.institute = null;
        this.data.years = null;
        await this.loadTab();
    }

    /** The school's own details — these appear on every receipt and certificate. */
    async editInstitute() {
        const current = this.data.institute || await institute();

        const saved = await formModal({
            title: 'Edit the school',
            description: 'Shown on receipts, certificates and reports.',
            submitLabel: 'Save changes',
            fields: [
                { name: 'name', label: 'Name', required: true },
                { name: 'tagline', label: 'Tagline', type: 'textarea', rows: 2 },
                { name: 'email', label: 'Email', type: 'email' },
                { name: 'phone', label: 'Phone', type: 'tel' },
                { name: 'website', label: 'Website' },
                { name: 'address', label: 'Address', type: 'textarea', rows: 2 },
                { name: 'gstin', label: 'GSTIN' }
            ],
            values: {
                name: current.name || '', tagline: current.tagline || '',
                email: current.email || '', phone: current.phone || '',
                website: current.website || '', address: current.address || '',
                gstin: current.gstin || ''
            },
            onSubmit: (values) => updateInstitute(values)
        });

        if (!saved) return;
        toast.success('School details saved');
        this.data.institute = null;
        await this.loadTab();
    }

    /**
     * Adds one entry to a master set (levels, programme types, expense
     * categories).
     *
     * ADDING ONLY. Renaming, reordering and deactivating are the operations
     * that actually carry risk here — `masterEntryUsage()` exists precisely so
     * an entry already in use cannot be quietly removed — and they need a
     * list editor with a usage check per row, not a one-field dialog. That is
     * its own piece of work; adding is separable and safe, so it ships now
     * rather than waiting behind it.
     */
    async addMasterEntry(setName) {
        const meta = MASTER_SETS[setName];
        if (!meta) return;

        const existing = (this.data.master || []).find((m) => m.set === setName)?.entries || [];

        const created = await formModal({
            title: `Add to ${meta.label.toLowerCase()}`,
            description: 'Appears wherever this list is offered — immediately, everywhere.',
            submitLabel: 'Add entry',
            fields: [
                { name: 'label', label: 'Name', required: true,
                  help: 'What people see in the dropdown.' },
                { name: 'value', label: 'Stored value',
                  help: 'Leave blank to derive it from the name. Cannot be changed later — '
                      + 'existing records point at it.' }
            ],
            /*
             * Two clash checks, and the second one is not redundant.
             *
             * addMasterEntry() compares only the derived *value*. That misses
             * a real case, found by walking into it: typing "foundation level
             * 1" derives `foundation-level-1`, which does not collide with the
             * shipped `foundation-1` — so the service accepted a second entry
             * labelled almost identically to "Foundation Level 1", and the
             * level dropdown then offered two of them. The label check below
             * is what stops that.
             *
             * This is a pre-flight only; the service still decides, and it
             * still owns the value check. The service-side label gap is
             * recorded in MIGRATION_CHECKLIST.md — it is inherited from the
             * reference project and is not this page's to fix unilaterally.
             */
            validateAll: (v) => {
                const label = String(v.label || '').trim();
                const slug = slugify(v.value || label);

                if (label && !slug) {
                    return { value: 'That name produces an empty stored value — give one explicitly.' };
                }
                if (slug && existing.some((e) => e.value === slug)) {
                    return { value: `"${slug}" is already in this list.` };
                }
                if (label && existing.some((e) => e.label.trim().toLowerCase() === label.toLowerCase())) {
                    return { label: `"${label}" is already in this list.` };
                }
                return null;
            },
            onSubmit: (values) => addMasterEntry(setName, values)
        });

        if (!created) return;
        toast.success(`Added to ${meta.label.toLowerCase()}`);
        this.data.master = null;
        await this.loadTab();
    }

    /**
     * Adds a user account.
     *
     * THE GUARDRAIL. `requireRoleAssignable()` in the service refuses to let
     * anyone without `role.manage` create an Administrator — otherwise every
     * Administrator-only capability would be one click from self-granted. This
     * form does NOT reimplement that rule; it just declines to offer a choice
     * the caller cannot make, so an Owner never picks Administrator and then
     * gets refused. The service is still the thing that decides, and
     * firestore.rules decides again server-side.
     */
    async addUser() {
        const roles = roleMatrix().roles
            .filter((r) => r.value !== 'administrator' || session.can(CAPABILITIES.ROLE_MANAGE))
            .map((r) => ({ value: r.value, label: r.label }));

        const created = await formModal({
            title: 'Add a user',
            description: session.can(CAPABILITIES.ROLE_MANAGE)
                ? 'Authorises an account to sign in. Every account needs at least one sign-in method.'
                : 'Authorises an account to sign in. Only an Administrator can grant the Administrator role, '
                  + 'so it is not offered here.',
            submitLabel: 'Add user',
            fields: [
                { name: 'name', label: 'Full name', required: true },
                { name: 'role', label: 'Role', type: 'select', required: true, placeholder: 'Choose a role',
                  options: roles },
                { name: 'authMethods', label: 'Sign-in methods', type: 'checks', required: true,
                  itemNoun: 'sign-in method',
                  options: [
                      { value: 'google', label: 'Google' },
                      { value: 'password', label: 'Email & password' },
                      { value: 'mobile', label: 'Mobile OTP' }
                  ],
                  help: 'No default is assumed — choose explicitly.' },
                { name: 'email', label: 'Email', type: 'email',
                  showIf: (v) => (v.authMethods || []).some((m) => m === 'google' || m === 'password'),
                  help: 'Required for Google and for Email & password.' },
                { name: 'password', label: 'Initial password', type: 'password',
                  showIf: (v) => (v.authMethods || []).includes('password'),
                  help: 'They should change it after signing in for the first time.' },
                { name: 'mobile', label: 'Mobile number', type: 'tel',
                  showIf: (v) => (v.authMethods || []).includes('mobile'),
                  help: 'Must be unique — Mobile OTP resolves an identity by number alone.' }
            ],
            values: { name: '', role: '', authMethods: [], email: '', password: '', mobile: '' },
            onSubmit: (values) => createUser(values)
        });

        if (!created) return;
        toast.success('User added', `${created.name} can now sign in.`);
        this.data.users = null;
        await this.loadTab();
    }

    /* -------------------------------------------------------- BACKUP / DATA */

    async takeBackup() {
        const done = await formModal({
            title: 'Download a backup',
            description: 'Reads every collection live and hands you one JSON file.',
            submitLabel: 'Download',
            fields: [
                { name: 'note', label: 'Note', type: 'textarea', rows: 2,
                  help: 'Optional. Stored in the file — "before the new term", "after the fee revision".' }
            ],
            values: { note: '' },
            onSubmit: (v) => downloadBackup({ note: v.note })
        });

        if (!done) return;
        toast.success('Backup downloaded',
            `${formatNumber(done.totalRecords)} records across ${done.sections} collections.`);
    }

    async exportOne() {
        const s = this.data.backupStatus;
        const options = (s?.sections || []).map(([key, n]) => ({
            value: key, label: `${key} — ${formatNumber(n)} records`
        }));
        if (!options.length) {
            toast.error('Nothing to export', 'No collection holds any records yet.');
            return;
        }

        const done = await formModal({
            title: 'Export one collection',
            description: 'For handing to an accountant or an auditor. Read-only — nothing changes.',
            submitLabel: 'Export',
            fields: [
                { name: 'key', label: 'Collection', type: 'select', required: true,
                  placeholder: 'Choose a collection', options }
            ],
            values: { key: '' },
            onSubmit: (v) => exportStore(v.key)
        });

        if (!done) return;
        toast.success('Exported', `${done.key} — ${formatNumber(done.rows)} rows.`);
    }

    /**
     * Reads the chosen file and describes it *before* offering to restore.
     *
     * Nothing is written here. The point is that the decision is made against
     * the file's real contents — how many records, taken when, by whom, and
     * whether this version can read it at all — rather than against a filename.
     */
    async previewRestore(file) {
        const target = this.container.querySelector('[data-role="restore-preview"]');
        this.pendingRestore = null;
        if (!file) { render(target, ''); return; }

        render(target, html`<div class="v3-skeleton">Reading the file…</div>`);

        let info;
        try {
            info = await inspectBackup(file);
        } catch (err) {
            render(target, html`<div class="v3-notice" data-tone="negative">${err.message}</div>`);
            return;
        }

        this.pendingRestore = info;

        render(target, html`
            ${info.legacy ? html`
                <div class="v3-notice" data-tone="negative">
                    <strong>This looks like a pre-v3 backup.</strong>
                    Only ${info.recognised.length} of
                    ${info.recognised.length + info.unknown.length} sections are recognised.
                    v3 keeps everything in Firestore and has no local store to restore the rest
                    into, so this file cannot be restored here. The previous version of the app
                    still reads it.
                </div>
            ` : ''}
            ${info.newerSchema ? html`
                <div class="v3-notice" data-tone="caution">
                    This file was written by a newer schema (${info.schemaVersion}) than this app
                    understands (${SCHEMA.version}). Restoring it may drop fields this version
                    does not know about.
                </div>
            ` : ''}

            <dl class="v3-facts" style="margin-top:12px;">
                ${fact('Taken', info.takenAtLabel)}
                ${fact('By', info.takenBy || '—')}
                ${fact('Records', formatNumber(info.totalRecords))}
                ${fact('Storage', info.storage)}
                ${fact('Accounts included', info.hasUsers ? 'Yes' : 'No')}
                ${info.note ? fact('Note', info.note) : ''}
            </dl>
            ${info.unknown.length ? html`
                <p class="v3-modal-note">
                    Not recognised, and will be left alone: ${info.unknown.join(', ')}.
                </p>
            ` : ''}

            ${info.legacy ? '' : html`
                <button class="v3-action-btn v3-btn-sm" data-action="do-restore" style="margin-top:12px;">
                    Restore ${formatNumber(info.totalRecords)} records
                </button>
            `}
        `);
    }

    /**
     * The restore itself.
     *
     * Confirmed against a typed phrase, not a button. This replaces every
     * record in the project; a single misplaced click should not be able to
     * do that, and "are you sure?" has long since stopped being read.
     */
    async doRestore() {
        const info = this.pendingRestore;
        if (!info) return;

        const done = await formModal({
            title: 'Restore this backup',
            description: `Every collection in this file replaces what is here now — `
                       + `${formatNumber(info.totalRecords)} records, taken ${info.takenAtLabel}. `
                       + 'A safety copy of the current data downloads first.',
            submitLabel: 'Restore',
            fields: [
                { name: 'restoreUsers', label: 'Also restore sign-in accounts', type: 'switch',
                  switchLabel: info.hasUsers ? 'Yes, replace the account list' : 'No accounts in this file',
                  help: 'Your own account is never touched, whatever this is set to.' },
                { name: 'confirm', label: 'Type RESTORE to confirm', required: true,
                  placeholder: 'RESTORE' }
            ],
            values: { restoreUsers: false, confirm: '' },
            validateAll: (v) => v.confirm.trim().toUpperCase() !== 'RESTORE'
                ? { confirm: 'Type RESTORE exactly, to confirm you mean this.' } : null,
            onSubmit: (v) => restore(info.backup, {
                safetyCopy: true,
                restoreUsers: Boolean(v.restoreUsers) && info.hasUsers
            })
        });

        if (!done) return;
        toast.success('Restored',
            `${formatNumber(done.recordsRestored)} records across ${done.sectionsRestored} collections`
            + (done.usersRestored ? `, ${done.usersRestored} accounts` : '')
            + (done.usersSkipped ? ` (${done.usersSkipped} skipped)` : ''));
        this.data = {};
        await this.loadTab();
    }

    async eraseAll() {
        const s = this.data.backupStatus;

        const done = await formModal({
            title: 'Erase all data',
            description: `${formatNumber(s?.totalRecords || 0)} records across `
                       + `${formatNumber(s?.sections?.length || 0)} collections will be deleted from `
                       + 'this Firebase project. A safety copy downloads first.',
            submitLabel: 'Erase everything',
            fields: [
                { name: 'keepInstitute', label: 'Keep the school details and branches', type: 'switch',
                  switchLabel: 'Yes, keep them',
                  help: 'The usual reason to erase is clearing demo data before entering your own.' },
                { name: 'confirm', label: 'Type ERASE to confirm', required: true,
                  placeholder: 'ERASE' }
            ],
            values: { keepInstitute: true, confirm: '' },
            validateAll: (v) => v.confirm.trim().toUpperCase() !== 'ERASE'
                ? { confirm: 'Type ERASE exactly. This cannot be undone from here.' } : null,
            onSubmit: async (v) => {
                const ok = await confirmModal({
                    title: 'Last check',
                    message: `This deletes ${formatNumber(s?.totalRecords || 0)} records. The only way `
                           + 'back is the safety copy that is about to download — keep it.',
                    confirmLabel: 'Erase everything',
                    tone: 'negative'
                });
                if (!ok) throw new Error('Not erased. Nothing has changed.');
                return resetEverything({ safetyCopy: true, keepInstitute: Boolean(v.keepInstitute) });
            }
        });

        if (!done) return;
        toast.success('Erased',
            `${formatNumber(done.recordsCleared)} records from ${done.collectionsCleared} collections.`);
        this.data = {};
        await this.loadTab();
    }
}

/* ------------------------------------------------------------------ HELPERS */

/**
 * The same slug rule addMasterEntry() applies, so the pre-flight clash check
 * compares the key that will actually be stored rather than the raw text.
 * Deliberately a copy of one line rather than an export added to the service:
 * if the service's rule ever changes, this check being *stale* only costs a
 * round trip — the service still refuses the duplicate.
 */
function slugify(text) {
    return String(text || '').trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * A card header with an optional primary action.
 *
 * `actionKey` is what makes the button live: pass one and it dispatches that
 * action, omit it and the button renders disabled with an explanation. That
 * keeps wired and unwired sections visually identical apart from the one thing
 * that differs — whether it can be pressed.
 */
function cardHead(title, note, action = null, actionKey = null) {
    return html`
        <div class="v3-card-head v3-register-head">
            <div>
                <h2 class="v3-card-title">${title}</h2>
                ${note ? html`<p class="v3-card-note">${note}</p>` : ''}
            </div>
            ${action ? (actionKey ? html`
                <button class="v3-action-btn v3-btn-sm" data-action="${actionKey}">${action}</button>
            ` : html`
                <button class="v3-action-btn v3-btn-sm" data-action="not-wired" disabled title="${NOT_WIRED}">
                    ${action}
                </button>
            `) : ''}
        </div>
    `;
}

function fact(label, value) {
    return html`<div class="v3-fact"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function titleCase(value) {
    return String(value || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

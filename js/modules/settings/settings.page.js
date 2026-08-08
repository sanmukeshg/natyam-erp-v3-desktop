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
 * EDITING (UAT desktop BUG-001). Branches, fee plans, curriculum entries and
 * users can all now be opened and edited from their row. Each editor reuses the
 * same field list as its create counterpart, seeded from the record, and hands
 * the whole set to the service — which owns validation.
 *
 * Two consequences are surfaced rather than swallowed:
 *   - `updateFeePlan()` reports how many students are billed on the plan going
 *     forward, so changing an amount is not a silent act. Invoices already
 *     raised keep their own amounts.
 *   - A master-set entry's **stored value is immutable** — `updateMasterEntry()`
 *     pins it because existing records point at that key. The dialog shows it
 *     read-only rather than hiding it, so that is a stated fact, not a surprise.
 *
 * Reordering and deleting master-set entries remain out of scope: they need a
 * per-row `masterEntryUsage()` check, and the UAT asked for editing.
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
    updateInstitute, addMasterEntry, createUser,
    updateBranch, updateFeePlan, updateMasterEntry, updateUser
} from '../../services/settings.service.js';
import { listHolidays, createHoliday, updateHoliday, removeHoliday } from '../../services/holidays.service.js';
import { search as searchAudit } from '../../services/audit.service.js';
import {
    backupStatus, downloadBackup, exportStore, inspectBackup, restore, resetEverything
} from '../../services/backup.service.js';
import { formModal, confirmModal } from '../../ui/form.js';
import { SECTIONS, CONTENT_KINDS, BLOCK_TYPES } from '../../config/websiteContent.config.js';
import {
    listSections, saveSection, unpublishSection,
    readField, buildItem, fieldName, validateItem
} from '../../services/websiteContent.service.js';
import { upload, remove as removeUpload, validateFile, UPLOAD_SCOPES } from '../../services/upload.service.js';

/** Same nine tabs, same order, same gating as the reference page. */
const TABS = [
    { key: 'institute', label: 'Institute', cap: null },
    { key: 'branches', label: 'Branches', cap: null },
    // Sits with the reference data rather than in a module of its own: a
    // holiday is a statement about the academy's calendar, edited once a term
    // alongside branches and fee plans, not an operational screen.
    { key: 'holidays', label: 'Holidays', cap: null },
    { key: 'fees', label: 'Fee plans', cap: null },
    { key: 'curriculum', label: 'Curriculum', cap: null },
    // The public-facing content management system. Sits with the other
    // reference-data tabs rather than in its own module because that is what
    // it is: the school describing itself, edited in one place, read by the
    // parent app and later by the Natyam website.
    { key: 'website', label: 'Website Content', cap: null },
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
        /** Which Website Content section is open, or null for the list. */
        this.websiteKey = null;
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
            } else if (this.tab === 'holidays' && !this.data.holidays) {
                // Branches ride along for the scope picker — a holiday may
                // close one site while the others stay open.
                const [holidays, branches] = await Promise.all([
                    listHolidays(),
                    this.data.branches ? Promise.resolve(this.data.branches) : listBranches()
                ]);
                this.data.holidays = holidays;
                this.data.branches = branches;
            } else if (this.tab === 'fees' && !this.data.feePlans) {
                this.data.feePlans = await listFeePlans({ includeInactive: true });
            } else if (this.tab === 'curriculum' && !this.data.master) {
                const sets = Object.keys(MASTER_SETS);
                const lists = await Promise.all(sets.map((s) => listMasterSet(s)));
                this.data.master = sets.map((s, i) => ({ set: s, meta: MASTER_SETS[s], entries: lists[i] }));
            } else if (this.tab === 'website' && !this.data.website) {
                this.data.website = await listSections();
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
            case 'holidays':    return this.holidaysPanel();
            case 'fees':        return this.feePlansPanel();
            case 'curriculum':  return this.curriculumPanel();
            case 'website':     return this.websitePanel();
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
                                ${session.can(CAPABILITIES.SETTINGS_EDIT) ? html`
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="edit-branch"
                                            data-id="${b.id}">Edit</button>
                                ` : ''}
                            </div>
                        `)}
                    </div>
                ` : html`<div class="v3-empty">No branches yet.</div>`}
            </section>
        `;
    }

    /**
     * Upcoming and past in two cards, because they answer different questions.
     * "When are we next shut" is the one being asked nearly every time, so it
     * leads and past closures sit below it rather than interleaved.
     *
     * Unlike Branches above, the create action is capability-gated here rather
     * than shown-and-refused: this tab is visible to everyone (a teacher wants
     * to know the academy is closed on Monday) and offering a button that
     * throws would be worse than not offering it.
     */
    holidaysPanel() {
        const { upcoming = [], past = [] } = this.data.holidays || {};
        const mayEdit = session.can(CAPABILITIES.SETTINGS_EDIT);
        const add = mayEdit ? 'Declare holiday' : null;

        return html`
            <section class="v3-card">
                ${cardHead('Upcoming holidays',
                    upcoming.length
                        ? `${upcoming.length} ahead. Next: ${formatDateLong(upcoming[0].date)}.`
                        : 'Nothing declared ahead of today.',
                    add, add ? 'add-holiday' : null)}
                ${upcoming.length ? html`
                    <div class="v3-list">
                        ${upcoming.map((h) => this.holidayRow(h, mayEdit))}
                    </div>
                ` : html`<div class="v3-empty">No holidays declared.</div>`}
                <div class="v3-card-body">
                    <div class="v3-notice" data-tone="info">
                        A holiday appears on the day board and goes out as a push reminder the
                        evening before. It does <strong>not</strong> cancel the classes scheduled
                        that day — cancel those in Timetable if they are not running.
                    </div>
                </div>
            </section>

            ${past.length ? html`
                <section class="v3-card">
                    ${cardHead('Earlier', 'Kept as the record of why a register is empty.')}
                    <div class="v3-list">
                        ${past.map((h) => this.holidayRow(h, mayEdit))}
                    </div>
                </section>
            ` : ''}
        `;
    }

    holidayRow(h, mayEdit) {
        const branch = h.branchId
            ? (this.data.branches || []).find((b) => b.id === h.branchId)
            : null;

        return html`
            <div class="v3-row">
                <div class="v3-row-main">
                    <div class="v3-row-title">${h.name}</div>
                    <div class="v3-row-detail">
                        ${formatDateLong(h.date)}${h.note ? ` · ${h.note}` : ''}
                    </div>
                </div>
                <span class="v3-chip" data-fee="${h.branchId ? '' : 'clear'}">
                    ${h.branchId ? (branch?.name || 'One branch') : 'All branches'}
                </span>
                ${mayEdit ? html`
                    <button class="v3-ghost-btn v3-btn-sm" data-action="edit-holiday"
                            data-id="${h.id}">Edit</button>
                    <button class="v3-ghost-btn v3-btn-sm" data-action="remove-holiday"
                            data-id="${h.id}">Remove</button>
                ` : ''}
            </div>
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
                                ${session.can(CAPABILITIES.SETTINGS_EDIT) ? html`
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="edit-plan"
                                            data-id="${p.id}">Edit</button>
                                ` : ''}
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
                                    ${session.can(CAPABILITIES.SETTINGS_EDIT) ? html`
                                        <button class="v3-ghost-btn v3-btn-sm" data-action="edit-entry"
                                                data-set="${set}" data-value="${e.value}">Edit</button>
                                    ` : ''}
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
                                ${session.can(CAPABILITIES.USER_EDIT) ? html`
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="edit-user"
                                            data-id="${u.id}">Edit</button>
                                ` : ''}
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
        this.onDispose(on(root, 'click', '[data-action="add-holiday"]', () => this.addHoliday()));
        this.onDispose(on(root, 'click', '[data-action="edit-holiday"]', (_e, t) => this.editHoliday(t.dataset.id)));
        this.onDispose(on(root, 'click', '[data-action="remove-holiday"]', (_e, t) => this.removeHoliday(t.dataset.id)));
        this.onDispose(on(root, 'click', '[data-action="add-year"]', () => this.addYear()));
        this.onDispose(on(root, 'click', '[data-action="edit-institute"]', () => this.editInstitute()));
        this.onDispose(on(root, 'click', '[data-action="edit-branch"]', (_e, t) => this.editBranch(t.dataset.id)));
        this.onDispose(on(root, 'click', '[data-action="edit-plan"]', (_e, t) => this.editFeePlan(t.dataset.id)));
        this.onDispose(on(root, 'click', '[data-action="edit-entry"]', (_e, t) =>
            this.editMasterEntry(t.dataset.set, t.dataset.value)));
        this.onDispose(on(root, 'click', '[data-action="edit-user"]', (_e, t) => this.editUser(t.dataset.id)));
        this.onDispose(on(root, 'click', '[data-action="take-backup"]', () => this.takeBackup()));
        this.onDispose(on(root, 'click', '[data-action="export-one"]', () => this.exportOne()));
        this.onDispose(on(root, 'click', '[data-action="erase-all"]', () => this.eraseAll()));
        this.onDispose(on(root, 'change', '[data-role="restore-file"]', (_e, t) =>
            this.previewRestore(t.files?.[0] || null)));
        this.onDispose(on(root, 'click', '[data-action="do-restore"]', () => this.doRestore()));
        this.onDispose(on(root, 'click', '[data-action="add-user"]', () => this.addUser()));
        this.onDispose(on(root, 'click', '[data-action^="add-entry:"]', (_e, t) =>
            this.addMasterEntry(t.dataset.action.split(':')[1])));

        /* ---- Website Content ---- */
        this.onDispose(on(root, 'click', '[data-action="website-open"]', (_e, t) => {
            this.websiteKey = t.dataset.key;
            this.paint();
        }));
        this.onDispose(on(root, 'click', '[data-action="website-back"]', () => {
            this.websiteKey = null;
            this.paint();
        }));
        this.onDispose(on(root, 'click', '[data-action="website-head"]', () => this.websiteEditHead()));
        this.onDispose(on(root, 'click', '[data-action="website-add-item"]', () => this.websiteItemForm()));
        this.onDispose(on(root, 'click', '[data-action="website-edit-item"]', (_e, t) =>
            this.websiteItemForm(Number(t.dataset.index))));
        this.onDispose(on(root, 'click', '[data-action="website-del-item"]', (_e, t) =>
            this.websiteCommit((e) => { e.items.splice(Number(t.dataset.index), 1); })));
        this.onDispose(on(root, 'click', '[data-action="website-move"]', (_e, t) =>
            this.websiteCommit((e) => moveWithin(e.items, Number(t.dataset.index), Number(t.dataset.dir)))));

        this.onDispose(on(root, 'click', '[data-action="website-add-para"]', () => this.websiteParagraphForm()));
        this.onDispose(on(root, 'click', '[data-action="website-edit-para"]', (_e, t) =>
            this.websiteParagraphForm(Number(t.dataset.index))));
        this.onDispose(on(root, 'click', '[data-action="website-del-para"]', (_e, t) =>
            this.websiteCommit((e) => removeParagraph(e, Number(t.dataset.index)))));
        this.onDispose(on(root, 'click', '[data-action="website-move-para"]', (_e, t) =>
            this.websiteCommit((e) => moveParagraph(e, Number(t.dataset.index), Number(t.dataset.dir)))));

        this.onDispose(on(root, 'click', '[data-action="website-facts"]', () => this.websiteFactsForm()));
        this.onDispose(on(root, 'click', '[data-action="website-image"]', () => this.websitePickImage()));
        this.onDispose(on(root, 'change', '[data-role="website-file"]', (_e, t) => {
            const file = t.files?.[0] || null;
            // Cleared so choosing the same file twice in a row still fires a
            // change event — otherwise a failed upload cannot be retried
            // without picking a different picture first.
            t.value = '';
            this.websiteUploadImage(file);
        }));
        this.onDispose(on(root, 'click', '[data-action="website-image-clear"]', () => this.websiteClearImage()));
        this.onDispose(on(root, 'click', '[data-action="website-unpublish"]', () => this.websiteUnpublish()));
    }

    /* ----------------------------------------------------- WEBSITE CONTENT */

    /**
     * Two views in one tab: a list of every section, and one section opened
     * for editing. `this.websiteKey` is which — null for the list.
     *
     * The editor is driven entirely by websiteContent.config.js. Nothing below
     * names About, Courses or Branches: it renders whatever sections are
     * declared, with whatever fields each declares, which is what lets Gallery
     * and the rest arrive later as configuration rather than as code.
     */
    websitePanel() {
        return this.websiteKey ? this.websiteEditor() : this.websiteList();
    }

    websiteList() {
        const rows = this.data.website || [];
        return html`
            <section class="v3-card">
                ${cardHead('Website Content',
                    'What parents see in the app, and what the Natyam website will show. Edited here and nowhere else.')}
                <div class="v3-card-body">
                    <div class="v3-roll">
                        ${rows.map((row) => html`
                            <button class="v3-roll-row" data-action="website-open" data-key="${row.section.key}">
                                <span class="v3-roll-main">
                                    <span class="v3-roll-name">${row.section.label}</span>
                                    <span class="v3-roll-meta">
                                        ${row.published
                                            ? `${this.websiteSummary(row.section, row.envelope)} · ${websiteStamp(row)}`
                                            : 'Not published — parents see “coming soon”.'}
                                    </span>
                                </span>
                                <span class="v3-roll-badges">
                                    <span class="v3-chip" data-tone="${row.published ? 'ok' : 'muted'}">
                                        ${row.published ? 'Published' : 'Empty'}
                                    </span>
                                </span>
                            </button>
                        `)}
                    </div>
                </div>
            </section>
        `;
    }

    /** A one-line description of what a section currently holds. */
    websiteSummary(section, envelope) {
        if (section.kind === CONTENT_KINDS.LIST) {
            const n = (envelope.items || []).length;
            return `${n} ${section.itemLabel.toLowerCase()}${n === 1 ? '' : 's'}`;
        }
        const paras = (envelope.blocks || []).filter((b) => b.type === BLOCK_TYPES.TEXT).length;
        return `${paras} paragraph${paras === 1 ? '' : 's'}`;
    }

    websiteRow() {
        return (this.data.website || []).find((r) => r.section.key === this.websiteKey) || null;
    }

    websiteEditor() {
        const row = this.websiteRow();
        if (!row) return html`<div class="v3-empty">That section no longer exists.</div>`;

        const { section, envelope } = row;
        const isList = section.kind === CONTENT_KINDS.LIST;

        return html`
            <section class="v3-card">
                <div class="v3-card-head">
                    <button class="v3-action-btn" data-action="website-back">← All sections</button>
                </div>
                ${cardHead(section.label, section.help, 'Edit heading', 'website-head')}
                <div class="v3-card-body">
                    <dl class="v3-facts">
                        ${fact(section.titleLabel, envelope.title || '—')}
                        ${fact(section.subtitleLabel, envelope.subtitle || '—')}
                    </dl>
                </div>
            </section>

            ${isList ? this.websiteItems(section, envelope) : this.websiteBlocks(section, envelope)}

            <section class="v3-card">
                <div class="v3-card-body v3-row-actions">
                    <button class="v3-action-btn v3-btn-danger" data-action="website-unpublish">
                        Remove this section
                    </button>
                </div>
            </section>
        `;
    }

    websiteItems(section, envelope) {
        const items = envelope.items || [];
        return html`
            <section class="v3-card">
                ${cardHead(`${section.itemLabel}s`, `Shown in this order.`,
                    `Add ${section.itemLabel.toLowerCase()}`, 'website-add-item')}
                <div class="v3-card-body">
                    ${items.length ? html`
                        <div class="v3-roll">
                            ${items.map((item, i) => html`
                                <div class="v3-roll-row">
                                    <span class="v3-roll-main">
                                        <span class="v3-roll-name">${item.title || '—'}</span>
                                        <span class="v3-roll-meta">
                                            ${[item.subtitle, ...(item.facts || []).map((f) => `${f.label}: ${f.value}`)]
                                                .filter(Boolean).join(' · ') || '—'}
                                        </span>
                                    </span>
                                    <span class="v3-roll-badges">
                                        <button class="v3-action-btn v3-btn-sm" data-action="website-move"
                                                data-index="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
                                        <button class="v3-action-btn v3-btn-sm" data-action="website-move"
                                                data-index="${i}" data-dir="1" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
                                        <button class="v3-action-btn v3-btn-sm" data-action="website-edit-item"
                                                data-index="${i}">Edit</button>
                                        <button class="v3-action-btn v3-btn-sm v3-btn-danger" data-action="website-del-item"
                                                data-index="${i}">Remove</button>
                                    </span>
                                </div>
                            `)}
                        </div>
                    ` : html`<div class="v3-empty">Nothing added yet.</div>`}
                </div>
            </section>
        `;
    }

    websiteBlocks(section, envelope) {
        const blocks = envelope.blocks || [];
        const paragraphs = blocks.filter((b) => b.type === BLOCK_TYPES.TEXT);
        const factsBlock = blocks.find((b) => b.type === BLOCK_TYPES.FACTS);
        const imageBlock = blocks.find((b) => b.type === BLOCK_TYPES.IMAGE);

        return html`
            ${section.allowImage ? html`
                <section class="v3-card">
                    ${cardHead(section.imageLabel || 'Picture',
                        'JPEG, PNG or WebP, up to 5 MB. Shown on the public page.',
                        imageBlock ? 'Replace' : 'Upload', 'website-image')}
                    <div class="v3-card-body">
                        ${imageBlock ? html`
                            <img src="${imageBlock.src}" alt="${imageBlock.alt || ''}"
                                 style="max-width:220px;border-radius:10px;display:block;margin-bottom:10px;">
                            <button class="v3-action-btn v3-btn-sm v3-btn-danger" data-action="website-image-clear">
                                Remove picture
                            </button>
                        ` : html`<div class="v3-empty">No picture yet.</div>`}
                        <input type="file" accept="image/jpeg,image/png,image/webp"
                               data-role="website-file" hidden>
                    </div>
                </section>
            ` : ''}

            <section class="v3-card">
                ${cardHead('Paragraphs', 'Shown in this order.', 'Add paragraph', 'website-add-para')}
                <div class="v3-card-body">
                    ${paragraphs.length ? html`
                        <div class="v3-roll">
                            ${paragraphs.map((b, i) => html`
                                <div class="v3-roll-row">
                                    <span class="v3-roll-main">
                                        <span class="v3-roll-meta" style="white-space:normal;">${b.text}</span>
                                    </span>
                                    <span class="v3-roll-badges">
                                        <button class="v3-action-btn v3-btn-sm" data-action="website-move-para"
                                                data-index="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
                                        <button class="v3-action-btn v3-btn-sm" data-action="website-move-para"
                                                data-index="${i}" data-dir="1" ${i === paragraphs.length - 1 ? 'disabled' : ''}>↓</button>
                                        <button class="v3-action-btn v3-btn-sm" data-action="website-edit-para"
                                                data-index="${i}">Edit</button>
                                        <button class="v3-action-btn v3-btn-sm v3-btn-danger" data-action="website-del-para"
                                                data-index="${i}">Remove</button>
                                    </span>
                                </div>
                            `)}
                        </div>
                    ` : html`<div class="v3-empty">No paragraphs yet.</div>`}
                </div>
            </section>

            <section class="v3-card">
                ${cardHead(section.factsLabel || 'Key facts', section.factHint || '', 'Edit facts', 'website-facts')}
                <div class="v3-card-body">
                    ${factsBlock?.facts?.length
                        ? html`<dl class="v3-facts">${factsBlock.facts.map((f) => fact(f.label, f.value))}</dl>`
                        : html`<div class="v3-empty">None.</div>`}
                </div>
            </section>
        `;
    }

    /* ------------------------------------------- WEBSITE CONTENT — ACTIONS */

    /**
     * Every mutation goes through here: change the envelope in memory, persist
     * the whole section, repaint. Saving on each action rather than behind a
     * "Save" button is the same contract the rest of Settings already has —
     * editing a branch saves a branch — and it means there is never an unsaved
     * state to lose by navigating away.
     */
    async websiteCommit(mutate) {
        const row = this.websiteRow();
        if (!row) return;

        const next = JSON.parse(JSON.stringify(row.envelope));
        mutate(next);

        try {
            const saved = await saveSection(row.section.key, next);
            row.envelope = saved;
            row.published = true;
            // Mirror the stamp the repository just wrote, so the section list
            // reads "updated … by …" immediately rather than only after a
            // reload. Updating `updatedAt` alone left the by-line blank on
            // every section saved in this session — the values were correct in
            // Firestore, just not in the copy on screen.
            row.updatedAt = new Date().toISOString();
            row.updatedBy = session.actorId();
            row.updatedByName = session.actorName();
            this.paint();
            toast.success('Saved', `${row.section.label} updated.`);
        } catch (err) {
            toast.error(err.message);
        }
    }

    async websiteEditHead() {
        const row = this.websiteRow();
        const { section, envelope } = row;

        // formModal() resolves with whatever onSubmit returns, and prefills
        // from a top-level `values` map rather than a per-field `value` — see
        // js/ui/form.js. Returning the values unchanged collects them here and
        // lets websiteCommit() do the persisting, so one code path saves every
        // kind of edit in this module.
        const values = await formModal({
            title: `${section.label} — heading`,
            fields: [
                { name: 'title', label: section.titleLabel, placeholder: section.titlePlaceholder },
                { name: 'subtitle', label: section.subtitleLabel, type: 'textarea',
                  placeholder: section.subtitlePlaceholder }
            ],
            values: { title: envelope.title, subtitle: envelope.subtitle },
            onSubmit: (v) => v
        });
        if (!values) return;

        await this.websiteCommit((e) => { e.title = values.title; e.subtitle = values.subtitle; });
    }

    async websiteItemForm(index = null) {
        const row = this.websiteRow();
        const { section, envelope } = row;
        const existing = index === null ? null : (envelope.items || [])[index];

        const values = await formModal({
            title: existing ? `Edit ${section.itemLabel.toLowerCase()}` : `Add ${section.itemLabel.toLowerCase()}`,
            fields: section.fields.map((f) => ({
                name: fieldName(f),
                label: f.label,
                type: f.type || 'text',
                required: Boolean(f.required),
                placeholder: f.placeholder || ''
            })),
            values: Object.fromEntries(
                section.fields.map((f) => [fieldName(f), existing ? readField(existing, f) : ''])),
            onSubmit: (v) => v
        });
        if (!values) return;

        const check = validateItem(section, values);
        if (!check.ok) { toast.error(Object.values(check.errors)[0]); return; }

        const item = buildItem(section, values, existing);
        await this.websiteCommit((e) => {
            e.items = e.items || [];
            if (existing) e.items[index] = item;
            else e.items.push(item);
        });
    }

    async websiteParagraphForm(index = null) {
        const row = this.websiteRow();
        const { section, envelope } = row;
        const paras = (envelope.blocks || []).filter((b) => b.type === BLOCK_TYPES.TEXT);
        const existing = index === null ? null : paras[index];

        const values = await formModal({
            title: existing ? `Edit ${section.paragraphLabel.toLowerCase()}` : `Add ${section.paragraphLabel.toLowerCase()}`,
            fields: [{ name: 'text', label: section.paragraphLabel, type: 'textarea', required: true }],
            values: { text: existing?.text || '' },
            onSubmit: (v) => v
        });
        if (!values?.text?.trim()) return;

        await this.websiteCommit((e) => {
            e.blocks = e.blocks || [];
            if (existing) {
                // Paragraphs are indexed among themselves, not among all
                // blocks — the image and facts blocks sit in the same array.
                let seen = -1;
                e.blocks = e.blocks.map((b) => {
                    if (b.type !== BLOCK_TYPES.TEXT) return b;
                    seen += 1;
                    return seen === index ? { ...b, text: values.text } : b;
                });
            } else {
                e.blocks.push({ type: BLOCK_TYPES.TEXT, text: values.text });
            }
        });
    }

    async websiteFactsForm() {
        const row = this.websiteRow();
        const existing = (row.envelope.blocks || []).find((b) => b.type === BLOCK_TYPES.FACTS);
        const rows = existing?.facts || [];

        // Four pairs is enough for the "Founded / Students / Branches" style
        // row these sections use, and a fixed set of inputs keeps this inside
        // the existing form modal rather than needing a repeater widget.
        const fields = [];
        const prefill = {};
        for (let i = 0; i < 4; i += 1) {
            fields.push({ name: `l${i}`, label: `Label ${i + 1}` });
            fields.push({ name: `v${i}`, label: `Value ${i + 1}` });
            prefill[`l${i}`] = rows[i]?.label || '';
            prefill[`v${i}`] = rows[i]?.value || '';
        }

        const values = await formModal({
            title: 'Key facts', fields, values: prefill, onSubmit: (v) => v
        });
        if (!values) return;

        const facts = [];
        for (let i = 0; i < 4; i += 1) {
            const label = (values[`l${i}`] || '').trim();
            const value = (values[`v${i}`] || '').trim();
            if (label && value) facts.push({ label, value });
        }

        await this.websiteCommit((e) => {
            e.blocks = (e.blocks || []).filter((b) => b.type !== BLOCK_TYPES.FACTS);
            if (facts.length) e.blocks.push({ type: BLOCK_TYPES.FACTS, facts });
        });
    }

    /** Opens the hidden file input; the change handler does the upload. */
    websitePickImage() {
        this.container.querySelector('[data-role="website-file"]')?.click();
    }

    async websiteUploadImage(file) {
        if (!file) return;

        const problem = validateFile(UPLOAD_SCOPES.WEBSITE_CONTENT, file);
        if (problem) { toast.error(problem); return; }

        const row = this.websiteRow();
        const previous = (row.envelope.blocks || []).find((b) => b.type === BLOCK_TYPES.IMAGE);

        toast.info('Uploading…', 'This can take a moment on a slow connection.');

        try {
            const { url, path } = await upload(UPLOAD_SCOPES.WEBSITE_CONTENT, {
                ownerId: row.section.key,
                file,
                replaces: previous?.imagePath || null
            });

            await this.websiteCommit((e) => {
                e.blocks = (e.blocks || []).filter((b) => b.type !== BLOCK_TYPES.IMAGE);
                // First, so the picture leads the page.
                e.blocks.unshift({
                    type: BLOCK_TYPES.IMAGE, src: url, imagePath: path,
                    alt: e.title || row.section.label, caption: ''
                });
            });
        } catch (err) {
            toast.error(err.message);
        }
    }

    async websiteClearImage() {
        const row = this.websiteRow();
        const existing = (row.envelope.blocks || []).find((b) => b.type === BLOCK_TYPES.IMAGE);
        if (!existing) return;

        const ok = await confirmModal({
            title: 'Remove this picture?',
            message: 'It will disappear from the public page immediately.',
            confirmLabel: 'Remove', tone: 'danger'
        });
        if (!ok) return;

        // The document first: a stored file nothing points at is invisible
        // clutter, whereas a live page pointing at a deleted file is a broken
        // image a parent sees.
        await this.websiteCommit((e) => {
            e.blocks = (e.blocks || []).filter((b) => b.type !== BLOCK_TYPES.IMAGE);
        });

        if (existing.imagePath) {
            await removeUpload(existing.imagePath)
                .catch((err) => console.error('Could not delete the removed picture', err));
        }
    }

    async websiteUnpublish() {
        const row = this.websiteRow();
        const ok = await confirmModal({
            title: `Remove ${row.section.label}?`,
            message: 'Everything in this section is deleted, and parents will see “coming soon” for it. '
                + 'Any pictures it holds are deleted too.',
            confirmLabel: 'Remove section', tone: 'danger'
        });
        if (!ok) return;

        try {
            await unpublishSection(row.section.key);
            row.envelope = row.section.kind === CONTENT_KINDS.LIST
                ? { kind: CONTENT_KINDS.LIST, title: '', subtitle: '', items: [] }
                : { kind: CONTENT_KINDS.PAGE, title: '', subtitle: '', blocks: [] };
            row.published = false;
            row.updatedAt = null;
            this.websiteKey = null;
            this.paint();
            toast.success('Removed', `${row.section.label} is no longer published.`);
        } catch (err) {
            toast.error(err.message);
        }
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

    /* ------------------------------------------------------------ HOLIDAYS */

    /**
     * "All branches" leads the scope list and is the default. An academy closes
     * as a whole far more often than a single site does, so the common case
     * costs nothing and the exception costs one selection.
     */
    holidayFields() {
        return [
            { name: 'name', label: 'Holiday', required: true, placeholder: 'Diwali' },
            { name: 'date', label: 'Date', type: 'date', required: true },
            { name: 'branchId', label: 'Applies to', type: 'select',
              options: [
                  { value: '', label: 'All branches' },
                  ...(this.data.branches || []).map((b) => ({ value: b.id, label: b.name }))
              ],
              help: 'Pick a branch only if the others stay open that day.' },
            { name: 'note', label: 'Note', type: 'textarea',
              help: 'Optional. Shown to staff on the day board.' }
        ];
    }

    async addHoliday() {
        const created = await formModal({
            title: 'Declare a holiday',
            description: 'Appears on the day board and goes out as a reminder the evening before.',
            submitLabel: 'Declare holiday',
            fields: this.holidayFields(),
            values: { branchId: '' },
            onSubmit: (values) => createHoliday(values)
        });

        if (!created) return;
        toast.success('Holiday declared', `${created.name} · ${formatDateLong(created.date)}`);
        this.data.holidays = null;
        await this.loadTab();
    }

    async editHoliday(id) {
        const h = this.findHoliday(id);
        if (!h) return;

        const saved = await formModal({
            title: `Edit ${h.name}`,
            description: 'Corrections apply from now — a reminder already sent cannot be recalled.',
            submitLabel: 'Save changes',
            fields: this.holidayFields(),
            values: {
                name: h.name || '', date: h.date || '',
                branchId: h.branchId || '', note: h.note || ''
            },
            onSubmit: (values) => updateHoliday(id, values)
        });

        if (!saved) return;
        toast.success('Holiday updated', saved.name);
        this.data.holidays = null;
        await this.loadTab();
    }

    async removeHoliday(id) {
        const h = this.findHoliday(id);
        if (!h) return;

        const ok = await confirmModal({
            title: `Remove ${h.name}?`,
            message: `${formatDateLong(h.date)} goes back to being an ordinary day. `
                + 'Nothing else changes — classes and registers are untouched either way.',
            confirmLabel: 'Remove',
            // caution, not negative: the row is soft-deleted and the audit
            // trail survives. (`.v3-notice` has no negative variant either —
            // the tone would render unstyled.)
            tone: 'caution'
        });
        if (!ok) return;

        try {
            await removeHoliday(id);
            toast.success('Holiday removed', h.name);
            this.data.holidays = null;
            await this.loadTab();
        } catch (err) {
            toast.error(err.message);
        }
    }

    /** Either group — the row that fired could be upcoming or past. */
    findHoliday(id) {
        const { upcoming = [], past = [] } = this.data.holidays || {};
        return [...upcoming, ...past].find((h) => h.id === id) || null;
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


    /* ------------------------------------------------------------- EDITING */
    /*
     * UAT desktop BUG-001. Every master-data section could create but not edit,
     * so a typo in a branch code or a fee amount was permanent. Each editor
     * below reuses the same field list as its create counterpart, seeded from
     * the existing record, and hands the whole set to the service — which owns
     * validation and the guardrails this page does not reimplement.
     */

    async editBranch(id) {
        const branch = (this.data.branches || []).find((b) => b.id === id);
        if (!branch) return;

        const saved = await formModal({
            title: `Edit ${branch.name}`,
            description: 'Shown on registers, receipts and reports.',
            submitLabel: 'Save changes',
            fields: [
                { name: 'name', label: 'Branch name', required: true },
                { name: 'code', label: 'Short code', required: true, maxLength: 10,
                  help: 'Used on registers and receipts. Stored in capitals.' },
                { name: 'address', label: 'Address', type: 'textarea', rows: 2 },
                { name: 'phone', label: 'Phone', type: 'tel' },
                { name: 'email', label: 'Email', type: 'email' }
            ],
            values: {
                name: branch.name || '', code: branch.code || '',
                address: branch.address || '', phone: branch.phone || '',
                email: branch.email || ''
            },
            onSubmit: (v) => updateBranch(id, { ...v, code: String(v.code || '').toUpperCase() })
        });

        if (!saved) return;
        toast.success('Branch updated', saved.name);
        this.data.branches = null;
        await this.loadTab();
    }

    /**
     * Editing a fee plan.
     *
     * `updateFeePlan()` returns `{ plan, affected }` — how many students sit on
     * this plan going forward. That answer is surfaced rather than swallowed:
     * changing an amount while dozens of students are billed against it is
     * exactly the kind of change somebody needs to see land. Invoices already
     * raised keep their own amounts; the service does not touch them.
     */
    async editFeePlan(id) {
        const plan = (this.data.feePlans || []).find((p) => p.id === id);
        if (!plan) return;

        const saved = await formModal({
            title: `Edit ${plan.name}`,
            description: 'Invoices already raised keep the amount they were raised at.',
            submitLabel: 'Save changes',
            fields: [
                { name: 'name', label: 'Plan name', required: true },
                { name: 'amount', label: 'Fee', type: 'money', required: true, min: 1,
                  help: 'Charged each period, in whole rupees.' },
                { name: 'frequency', label: 'Charged', type: 'select', required: true,
                  options: exposedFeeFrequencies().map((f) => ({ value: f.value, label: f.label })) },
                { name: 'registrationFee', label: 'One-off registration fee', type: 'money', min: 0 },
                { name: 'costumeFee', label: 'One-off costume fee', type: 'money', min: 0 }
            ],
            values: {
                name: plan.name || '', amount: plan.amount ?? '',
                frequency: plan.frequency || 'monthly',
                registrationFee: plan.registrationFee ?? '',
                costumeFee: plan.costumeFee ?? ''
            },
            onSubmit: (v) => updateFeePlan(id, v)
        });

        if (!saved) return;
        toast.success('Fee plan updated', saved.affected
            ? `${formatNumber(saved.affected)} student${saved.affected === 1 ? '' : 's'} billed on this plan going forward.`
            : 'No student is on this plan yet.');
        this.data.feePlans = null;
        await this.loadTab();
    }

    /**
     * Editing a curriculum / programme-type / expense-category entry.
     *
     * The label and the status are editable; the **stored value is not**.
     * `updateMasterEntry()` pins it deliberately (`value: entry.value`) because
     * existing records point at that key — changing it would orphan them. The
     * dialog shows it read-only rather than hiding it, so the immutability is
     * visible rather than surprising.
     */
    async editMasterEntry(setName, value) {
        const group = (this.data.master || []).find((m) => m.set === setName);
        const entry = group?.entries.find((e) => e.value === value);
        if (!entry) return;

        const others = (group.entries || []).filter((e) => e.value !== value);

        const saved = await formModal({
            title: `Edit ${entry.label}`,
            description: `In ${group.meta.label.toLowerCase()}. Appears wherever this list is offered.`,
            submitLabel: 'Save changes',
            fields: [
                { name: 'label', label: 'Name', required: true,
                  help: 'What people see in the dropdown.' },
                { name: 'storedValue', label: 'Stored value', readonly: true,
                  help: 'Cannot be changed — existing records point at it.' },
                { name: 'status', label: 'Status', type: 'select',
                  options: [
                      { value: 'active', label: 'Active — offered in dropdowns' },
                      { value: 'inactive', label: 'Inactive — hidden from new records' }
                  ],
                  help: 'Making an entry inactive hides it from new records; anything already '
                      + 'using it keeps it.' }
            ],
            values: {
                label: entry.label || '',
                storedValue: entry.value,
                status: entry.status || 'active'
            },
            // A duplicate label is confusing even when the stored keys differ —
            // the dropdown would offer the same words twice.
            validateAll: (v) => {
                const label = String(v.label || '').trim().toLowerCase();
                return label && others.some((e) => e.label.trim().toLowerCase() === label)
                    ? { label: `"${v.label.trim()}" is already in this list.` } : null;
            },
            onSubmit: (v) => updateMasterEntry(setName, value, {
                label: String(v.label).trim(),
                status: v.status
            })
        });

        if (!saved) return;
        toast.success('Entry updated', group.meta.label);
        this.data.master = null;
        await this.loadTab();
    }

    /**
     * Editing a user.
     *
     * The same guardrail as creation, and for the same reason: the role list
     * omits Administrator unless the caller holds `role.manage`, so an Owner is
     * never offered a choice `requireRoleAssignable()` would refuse. The service
     * also refuses *any* edit to an existing Administrator account without that
     * capability — this page does not reimplement that, it just lets the
     * message through.
     *
     * Passwords are absent: `updateUser()` only toggles which methods are
     * permitted, it never creates or changes a Firebase Auth credential.
     */
    async editUser(id) {
        const user = (this.data.users || []).find((u) => u.id === id);
        if (!user) return;

        const roles = roleMatrix().roles
            .filter((r) => r.value !== 'administrator' || session.can(CAPABILITIES.ROLE_MANAGE))
            .map((r) => ({ value: r.value, label: r.label }));

        const saved = await formModal({
            title: `Edit ${user.name}`,
            description: session.can(CAPABILITIES.ROLE_MANAGE)
                ? 'Changes which account details and sign-in methods are permitted.'
                : 'Only an Administrator can grant or edit the Administrator role, so it is not offered.',
            submitLabel: 'Save changes',
            fields: [
                { name: 'name', label: 'Full name', required: true },
                { name: 'role', label: 'Role', type: 'select', required: true, options: roles },
                { name: 'status', label: 'Status', type: 'select',
                  options: [
                      { value: 'active', label: 'Active — can sign in' },
                      { value: 'inactive', label: 'Inactive — cannot sign in' }
                  ] },
                { name: 'authMethods', label: 'Sign-in methods', type: 'checks', required: true,
                  itemNoun: 'sign-in method',
                  options: [
                      { value: 'google', label: 'Google' },
                      { value: 'password', label: 'Email & password' },
                      { value: 'mobile', label: 'Mobile OTP' }
                  ],
                  help: 'Permits a method — it does not create a password. '
                      + 'An account needs at least one.' },
                { name: 'email', label: 'Email', type: 'email',
                  showIf: (v) => (v.authMethods || []).some((m) => m === 'google' || m === 'password') },
                { name: 'mobile', label: 'Mobile number', type: 'tel',
                  showIf: (v) => (v.authMethods || []).includes('mobile'),
                  help: 'Must be unique — Mobile OTP resolves an identity by number alone.' }
            ],
            values: {
                name: user.name || '',
                role: user.role || '',
                status: user.status || 'active',
                authMethods: Array.isArray(user.authMethods) ? user.authMethods : [],
                email: user.email || '',
                mobile: user.mobile || ''
            },
            onSubmit: (v) => updateUser(id, v)
        });

        if (!saved) return;
        toast.success('User updated', saved.name || user.name);
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
                /*
                 * This help text is the ONLY place anyone is told what
                 * survives, so it has to name everything resetEverything()'s
                 * `kept` list holds. Staff and batches were added there in
                 * UAT5; leaving the wording alone would have had the dialog
                 * promise less than the code delivers — the safer direction to
                 * be wrong in, but still wrong: somebody would rebuild a
                 * timetable that had never been deleted.
                 */
                { name: 'keepInstitute', label: 'Keep your school’s setup', type: 'switch',
                  switchLabel: 'Yes, keep it',
                  help: 'Keeps school details, branches, fee plans, curriculum, programme types, '
                      + 'expense categories, roles and website content — and your staff and '
                      + 'batches, so the timetable and who teaches it survive. Deletes only the '
                      + 'records about people — students, admissions, attendance, invoices, '
                      + 'payments and the rest. Your user accounts are never touched either way.' },
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

/* ------------------------------------------- WEBSITE CONTENT — ORDERING ---
   Reordering is a swap with the neighbour rather than a drag: it works with
   a keyboard, on a touchscreen and with a screen reader, and this is a list
   of five branches rather than a hundred.
   -------------------------------------------------------------------------- */

/**
 * "updated 5 August 2026 by Sai" — the system-managed audit stamp.
 *
 * Administration only. This is never returned to the mobile app or the
 * website: it lives at document level, outside the `value` envelope those
 * read, so it cannot leak onto a public page even by accident.
 *
 * Older documents written before this metadata existed carry no `updatedBy`,
 * so the "by …" half is dropped rather than rendered as "by null".
 */
function websiteStamp(row) {
    if (!row.updatedAt) return 'never updated';
    const when = formatDateLong(row.updatedAt.slice(0, 10));
    const who = row.updatedByName || row.updatedBy;
    return who ? `updated ${when} by ${who}` : `updated ${when}`;
}

/** Swaps an entry with its neighbour, in place. Out-of-range moves no-op. */
function moveWithin(list, index, direction) {
    const target = index + direction;
    if (!Array.isArray(list) || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
}

/**
 * Paragraph indices are counted among paragraphs only, because the blocks
 * array also holds the image and facts blocks. These two translate a
 * paragraph index into a position in that mixed array.
 */
function paragraphPositions(envelope) {
    return (envelope.blocks || [])
        .map((b, i) => (b.type === BLOCK_TYPES.TEXT ? i : -1))
        .filter((i) => i >= 0);
}

function removeParagraph(envelope, index) {
    const at = paragraphPositions(envelope)[index];
    if (at === undefined) return;
    envelope.blocks.splice(at, 1);
}

function moveParagraph(envelope, index, direction) {
    const positions = paragraphPositions(envelope);
    const from = positions[index];
    const to = positions[index + direction];
    if (from === undefined || to === undefined) return;
    [envelope.blocks[from], envelope.blocks[to]] = [envelope.blocks[to], envelope.blocks[from]];
}

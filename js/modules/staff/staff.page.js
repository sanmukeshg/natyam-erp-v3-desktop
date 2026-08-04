/**
 * Natyam ERP v3 — Admin — Staff
 *
 * A dance school's staff record is small but load-bearing: it decides who can
 * be assigned to a batch, what the salary run pays out, and whose name appears
 * on a certificate.
 *
 * THE RULE THIS SCREEN EXISTS TO ENFORCE, and it is the service's, not this
 * page's: a teacher who leaves must not silently disappear from the batches
 * they were running. `deactivate()` refuses outright while they still hold
 * batches, throwing with `err.batches` attached, unless it is told who takes
 * them over. This page catches that and asks — it does not reimplement the
 * check, and it cannot bypass it.
 *
 * NO DESIGN FILE. `Staff.dc.html` was never generated (the design project was
 * deleted before Phase 2 — see docs/design/README.md). This reuses the shapes
 * that Students and Parents already established: KPI strip, filter bar, the
 * `v3-roll` card list, and a centred detail modal. Consistent by construction
 * with screens that do have an approved design.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on, debounce } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatMoney, formatNumber } from '../../utils/money.js';
import { localDate, formatDateLong } from '../../utils/date.js';
import { CAPABILITIES } from '../../config/app.config.js';
import {
    STAFF_ROLES, listStaff, staffSummary, teacherDashboard,
    hire, updateStaff, deactivate, reactivate
} from '../../services/staff.service.js';
import { listBranches } from '../../services/settings.service.js';
import { formModal, confirmModal } from '../../ui/form.js';

const FILTERS = [
    { key: null, label: 'All' },
    { key: 'teacher', label: 'Teachers' },
    { key: 'unassigned', label: 'No batches' },
    { key: 'inactive', label: 'Past staff' }
];

export default class StaffPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Staff';
        this.filter = this.query.filter || null;
        this.search = '';
        this.rows = [];
        this.stats = null;
        this.detail = null;
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head v3-page-head-row">
                <div>
                    <h1 class="v3-page-title">Staff</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading…</p>
                </div>
                <div class="v3-head-actions">
                    ${session.can(CAPABILITIES.STAFF_EDIT) ? html`
                        <button class="v3-action-btn v3-btn-md" data-action="hire">
                            ${raw(icon('plus', { size: 14 }))} Add staff
                        </button>
                    ` : ''}
                </div>
            </div>
            <div class="v3-page-body">
                <div data-role="summary"></div>
                <section class="v3-filterbar">
                    <div class="v3-filter-row">
                        <label class="v3-search-field">
                            ${raw(icon('search', { size: 15 }))}
                            <span class="sr-only">Search staff</span>
                            <input type="search" data-role="search" placeholder="Search name, role, specialisation…">
                        </label>
                    </div>
                    <div class="v3-chips" data-role="chips"></div>
                </section>
                <section class="v3-card" data-role="list">
                    <div class="v3-skeleton">Loading staff…</div>
                </section>
            </div>
            <div data-role="modal"></div>
        `);

        this.bind();
        await this.load();

        [EVENTS.STAFF_CREATED, EVENTS.STAFF_UPDATED, EVENTS.BATCH_UPDATED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    async load() {
        try {
            // "Past staff" is the one filter that needs a different query, not
            // a different predicate — inactive people are excluded server-side.
            const [rows, stats] = await Promise.all([
                listStaff(session.branch(), { includeInactive: this.filter === 'inactive' }),
                staffSummary(session.branch())
            ]);
            if (this.disposed) return;
            this.rows = rows;
            this.stats = stats;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Staff failed to load', err);
            render(this.container.querySelector('[data-role="list"]'), html`
                <div class="v3-empty">Staff could not be loaded — ${err.message}</div>
            `);
        }
    }

    visibleRows() {
        let rows = this.rows.filter((s) => {
            if (this.filter === 'teacher') return s.role === 'teacher';
            if (this.filter === 'unassigned') return s.role === 'teacher' && s.batchCount === 0;
            if (this.filter === 'inactive') return s.status !== 'active';
            return true;
        });

        const term = this.search.trim().toLowerCase();
        if (term) {
            rows = rows.filter((s) =>
                [s.name, s.roleLabel, s.specialisation, s.employeeNo, s.phone, s.branchNames]
                    .some((v) => String(v || '').toLowerCase().includes(term)));
        }
        return rows;
    }

    paint() {
        const rows = this.visibleRows();
        const s = this.stats || {};

        render(this.container.querySelector('[data-role="subtitle"]'),
            `${rows.length} of ${this.rows.length} on the books`);

        render(this.container.querySelector('[data-role="summary"]'), html`
            <div class="v3-kpis">
                ${kpi('On staff', formatNumber(s.total || 0), 'neutral')}
                ${kpi('Teachers', formatNumber(s.teachers || 0), 'neutral',
                      `${formatNumber(s.others || 0)} other role${s.others === 1 ? '' : 's'}`)}
                ${kpi('Monthly wage bill', formatMoney(s.monthlyWageBill || 0), 'neutral')}
                ${kpi('This month’s payroll',
                      s.payrollRun ? `${formatNumber(s.payrollPaid || 0)} paid` : 'Not run',
                      s.payrollRun && !s.payrollPending ? 'positive' : 'caution',
                      s.payrollRun
                          ? `${formatNumber(s.payrollPending || 0)} still pending`
                          : 'Run it from Finance')}
            </div>
        `);

        render(this.container.querySelector('[data-role="chips"]'), html`
            ${FILTERS.map((f) => html`
                <button class="v3-pill" data-action="filter" data-key="${f.key || ''}"
                        aria-pressed="${this.filter === f.key ? 'true' : 'false'}">${f.label}</button>
            `)}
        `);

        render(this.container.querySelector('[data-role="list"]'), rows.length ? html`
            <div class="v3-roll">
                ${rows.map((m) => html`
                    <button class="v3-roll-row" data-action="open" data-id="${m.id}">
                        <span class="v3-roll-main">
                            <span class="v3-roll-name">
                                ${m.name}
                                ${m.status !== 'active' ? html`
                                    <span class="v3-chip" style="margin-left:8px;">left</span>
                                ` : ''}
                            </span>
                            <span class="v3-roll-meta">
                                ${m.roleLabel}${m.specialisation ? ` · ${m.specialisation}` : ''}
                                · ${m.branchNames}
                            </span>
                        </span>
                        ${m.role === 'teacher' ? html`
                            <span class="v3-chip" data-fee="${m.batchCount ? 'clear' : 'overdue'}">
                                ${m.batchCount ? `${m.batchCount} batch${m.batchCount === 1 ? '' : 'es'}` : 'No batches'}
                            </span>
                        ` : ''}
                        <span class="v3-chip">${m.monthlySalary ? formatMoney(m.monthlySalary) : '—'}</span>
                    </button>
                `)}
            </div>
        ` : html`
            <div class="v3-empty">
                ${this.rows.length ? 'Nobody matches that.' : 'No staff on the books yet.'}
            </div>
        `);

        this.paintDetail();
    }

    /* ---------------------------------------------------------------- DETAIL */

    async open(id) {
        try {
            this.detail = await teacherDashboard(id);
            if (this.disposed) return;
            this.paintDetail();
        } catch (err) {
            toast.error(err.message);
        }
    }

    close() { this.detail = null; this.paintDetail(); }

    paintDetail() {
        const target = this.container.querySelector('[data-role="modal"]');
        const d = this.detail;
        if (!d) { render(target, ''); return; }

        const m = d.staff;
        const row = this.rows.find((r) => r.id === m.id) || {};

        render(target, html`
            <div class="v3-modal-scrim" data-role="scrim">
                <div class="v3-modal" role="dialog" aria-modal="true" aria-label="${m.name}">
                    <div class="v3-modal-head">
                        <div>
                            <h2 class="v3-modal-title">${m.name}</h2>
                            <p class="v3-modal-sub">
                                ${row.roleLabel || m.role}${m.employeeNo ? ` · ${m.employeeNo}` : ''}
                                ${m.status !== 'active' && m.leftOn ? ` · left ${formatDateLong(m.leftOn)}` : ''}
                            </p>
                        </div>
                        <button class="v3-modal-close" data-action="close-detail" aria-label="Close">
                            ${raw(icon('x', { size: 15 }))}
                        </button>
                    </div>

                    <div class="v3-modal-body">
                        ${m.status !== 'active' ? html`
                            <div class="v3-notice" data-tone="caution">
                                No longer on staff${m.leaveReason ? ` — ${m.leaveReason}` : ''}.
                            </div>
                        ` : ''}

                        <div class="v3-facts">
                            ${fact('Phone', m.phone || '—')}
                            ${fact('Email', m.email || '—')}
                            ${fact('Based at', row.branchNames || '—')}
                            ${fact('Joined', m.joinedOn ? formatDateLong(m.joinedOn) : '—')}
                            ${fact('Salary', m.monthlySalary ? formatMoney(m.monthlySalary) : '—')}
                            ${fact('Specialisation', m.specialisation || '—')}
                        </div>

                        ${d.batches?.length ? html`
                            <h3 class="v3-card-title" style="font-size:14px;">Batches</h3>
                            <div class="v3-roll">
                                ${d.batches.map((b) => html`
                                    <a class="v3-roll-row" href="#/batches?batch=${b.batch.id}">
                                        <span class="v3-roll-main">
                                            <span class="v3-roll-name">${b.batch.name}</span>
                                            <span class="v3-roll-meta">
                                                ${formatNumber(b.enrolled)} enrolled ·
                                                ${b.sessionsMarked} register${b.sessionsMarked === 1 ? '' : 's'} in 60 days
                                            </span>
                                        </span>
                                        <span class="v3-chip"
                                              data-fee="${b.attendanceRate === null ? '' : (b.attendanceRate >= 75 ? 'clear' : 'overdue')}">
                                            ${b.attendanceRate === null ? 'No marks' : `${b.attendanceRate}%`}
                                        </span>
                                    </a>
                                `)}
                            </div>
                        ` : html`
                            <p class="v3-modal-note">
                                ${m.role === 'teacher'
                                    ? 'Not teaching any batch right now.'
                                    : 'This role does not take batches.'}
                            </p>
                        `}
                    </div>

                    <div class="v3-modal-foot">
                        <button class="v3-ghost-btn v3-btn-md" data-action="close-detail">Close</button>
                        ${m.phone ? html`<a class="v3-ghost-btn v3-btn-md" href="tel:${m.phone}">Call</a>` : ''}
                        ${session.can(CAPABILITIES.STAFF_EDIT) ? (m.status === 'active' ? html`
                            <button class="v3-ghost-btn v3-btn-md" data-action="deactivate">End employment</button>
                            <button class="v3-action-btn v3-btn-md" data-action="edit">Edit</button>
                        ` : html`
                            <button class="v3-action-btn v3-btn-md" data-action="reactivate">Bring back</button>
                        `) : ''}
                    </div>
                </div>
            </div>
        `);
    }

    /* ------------------------------------------------------------ ADD / EDIT */

    async staffFields(existing = null) {
        const branches = await listBranches();
        const defaults = existing
            ? (Array.isArray(existing.branchIds) && existing.branchIds.length
                ? existing.branchIds
                : (existing.branchId ? [existing.branchId] : []))
            : (session.branch() ? [session.branch()] : (branches.length === 1 ? [branches[0].id] : []));

        return [
            { name: 'name', label: 'Full name', required: true, value: existing?.name },
            { name: 'role', label: 'Role', type: 'select', required: true, placeholder: 'Choose a role',
              options: STAFF_ROLES.map((r) => ({ value: r.value, label: r.label })),
              value: existing?.role },
            // A multi-select, not a single branch: staff.service supports someone
            // based at more than one, and the batch conflict check relies on it —
            // a teacher cannot take overlapping classes wherever they are.
            { name: 'branchIds', label: 'Based at', type: 'checks', required: true, itemNoun: 'branch',
              options: branches.map((b) => ({ value: b.id, label: b.name })),
              value: defaults },
            { name: 'phone', label: 'Phone', type: 'tel', required: true, value: existing?.phone },
            { name: 'email', label: 'Email', type: 'email', value: existing?.email },
            { name: 'specialisation', label: 'Specialisation', value: existing?.specialisation,
              help: 'Nritta, abhinaya, mridangam…' },
            { name: 'monthlySalary', label: 'Monthly salary', type: 'money', min: 0,
              value: existing?.monthlySalary },
            { name: 'joinedOn', label: 'Joined on', type: 'date',
              value: existing?.joinedOn || localDate(),
              validate: (v) => v && v > localDate() ? 'The joining date cannot be in the future.' : null },
            { name: 'employeeNo', label: 'Employee number', value: existing?.employeeNo,
              help: existing ? null : 'Leave blank and one is allocated automatically.' }
        ];
    }

    static seed(fields) {
        return Object.fromEntries(fields.map((f) =>
            [f.name, f.value ?? (f.type === 'checks' ? [] : '')]));
    }

    async hireStaff() {
        session.require(CAPABILITIES.STAFF_EDIT, 'add a staff member');
        const fields = await this.staffFields();

        const created = await formModal({
            title: 'Add staff',
            description: 'Who they are, where they work, and what they are paid.',
            submitLabel: 'Add',
            fields,
            values: StaffPage.seed(fields),
            onSubmit: (v) => hire(v)
        });

        if (!created) return;
        toast.success('Added to staff', `${created.name} — ${created.employeeNo}`);
        await this.load();
        this.open(created.id);
    }

    async editStaff() {
        const m = this.detail?.staff;
        if (!m) return;
        const fields = await this.staffFields(m);

        const saved = await formModal({
            title: `Edit ${m.name}`,
            fields,
            values: StaffPage.seed(fields),
            submitLabel: 'Save changes',
            onSubmit: (v) => updateStaff(m.id, v)
        });

        if (!saved) return;
        toast.success('Staff updated.');
        await this.open(m.id);
        await this.load();
    }

    /**
     * Ends someone's employment.
     *
     * `deactivate()` throws with `err.batches` attached when they still run
     * batches and no replacement was named. This catches that, asks who takes
     * them over, and retries — it does not pre-empt the check, so the rule
     * stays in one place and nothing here can route around it.
     */
    async endEmployment() {
        const m = this.detail?.staff;
        if (!m) return;

        const teachers = this.rows.filter((r) =>
            r.role === 'teacher' && r.status === 'active' && r.id !== m.id);

        const done = await formModal({
            title: `End ${m.name}'s employment`,
            description: 'They stay on record — attendance, payroll and certificates all '
                       + 'reference them. This marks them as no longer on staff.',
            submitLabel: 'End employment',
            fields: [
                { name: 'reason', label: 'Why', required: true,
                  placeholder: 'Resigned, contract ended…' },
                { name: 'lastDay', label: 'Last day', type: 'date',
                  help: 'Defaults to today.' },
                /*
                 * With no other active teacher on the books this dropdown is
                 * empty, and the service will then refuse the whole operation
                 * for anyone who still holds batches — correctly, since there
                 * is nobody to hand them to. Saying that here beats offering an
                 * empty select under a placeholder that reads like a choice.
                 */
                { name: 'reassignTo', label: 'Hand their batches to', type: 'select',
                  placeholder: teachers.length
                      ? 'Nobody — they teach none'
                      : 'No other teacher on the books',
                  options: teachers.map((t) => ({
                      value: t.id,
                      label: `${t.name} — ${t.batchCount} batch${t.batchCount === 1 ? '' : 'es'}`
                  })),
                  help: teachers.length
                      ? 'Required only if they currently run batches.'
                      : 'There is no other active teacher to take a batch over. Anyone still '
                        + 'running one cannot be taken off staff until another teacher exists.' }
            ],
            values: { reason: '', lastDay: localDate(), reassignTo: '' },
            onSubmit: async (v) => {
                const payload = {
                    reason: v.reason,
                    lastDay: v.lastDay || null,
                    reassignTo: v.reassignTo || null
                };
                try {
                    return await deactivate(m.id, payload);
                } catch (err) {
                    // The service names the batches. Surface them rather than
                    // just the sentence, so the person can see what they are
                    // about to hand over.
                    if (!err.batches?.length) throw err;
                    throw new Error(
                        `${err.message} They currently teach: `
                        + err.batches.map((b) => b.name).join(', ') + '.');
                }
            }
        });

        if (!done) return;
        toast.success(
            `${m.name} is no longer on staff`,
            done.reassigned
                ? `${done.reassigned} batch${done.reassigned === 1 ? '' : 'es'} handed over.`
                : 'They taught no batches.');
        this.close();
        await this.load();
    }

    async bringBack() {
        const m = this.detail?.staff;
        if (!m) return;

        const ok = await confirmModal({
            title: `Bring ${m.name} back?`,
            message: 'They become assignable to batches again. Their previous batches are '
                   + 'not restored — assign them explicitly.',
            confirmLabel: 'Bring back',
            tone: 'caution'
        });
        if (!ok) return;

        try {
            await reactivate(m.id);
            toast.success(`${m.name} is back on staff.`);
            this.close();
            await this.load();
        } catch (err) {
            toast.error(err.message);
        }
    }

    bind() {
        const root = this.container;

        this.onDispose(on(root, 'click', '[data-action="filter"]', (_e, t) => {
            const key = t.dataset.key || null;
            const next = this.filter === key ? null : key;
            const needsReload = next === 'inactive' || this.filter === 'inactive';
            this.filter = next;
            if (needsReload) this.load(); else this.paint();
        }));

        this.onDispose(on(root, 'input', '[data-role="search"]', debounce((_e, t) => {
            this.search = t.value;
            this.paint();
            const field = root.querySelector('[data-role="search"]');
            if (field && document.activeElement !== field) {
                field.focus();
                field.setSelectionRange(field.value.length, field.value.length);
            }
        }, 180)));

        this.onDispose(on(root, 'click', '[data-action="open"]', (_e, t) => this.open(t.dataset.id)));
        this.onDispose(on(root, 'click', '[data-action="close-detail"]', () => this.close()));
        this.onDispose(on(root, 'click', '[data-role="scrim"]', (event, target) => {
            if (event.target !== target) return;
            this.close();
        }));

        this.onDispose(on(root, 'click', '[data-action="hire"]', () => this.hireStaff()));
        this.onDispose(on(root, 'click', '[data-action="edit"]', () => this.editStaff()));
        this.onDispose(on(root, 'click', '[data-action="deactivate"]', () => this.endEmployment()));
        this.onDispose(on(root, 'click', '[data-action="reactivate"]', () => this.bringBack()));

        this.onKey = (event) => { if (event.key === 'Escape' && this.detail) this.close(); };
        window.addEventListener('keydown', this.onKey);
        this.onDispose(() => window.removeEventListener('keydown', this.onKey));
    }
}

/* ------------------------------------------------------------------ HELPERS */

function kpi(label, value, tone, note = null) {
    return html`
        <div class="v3-kpi" data-tone="${tone}">
            <div style="flex:1;min-width:0;">
                <div class="v3-kpi-label">${label}</div>
                <div class="v3-kpi-value">${value}</div>
                ${note ? html`<div class="v3-kpi-delta" data-tone="${tone}">${note}</div>` : ''}
            </div>
        </div>
    `;
}

function fact(label, value) {
    return html`<div class="v3-fact"><dt>${label}</dt><dd>${value}</dd></div>`;
}

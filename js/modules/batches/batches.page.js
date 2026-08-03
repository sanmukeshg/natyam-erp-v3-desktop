/**
 * Natyam ERP v3 — Admin — Batches
 *
 * NO APPROVED v3 DESIGN EXISTS FOR THIS SCREEN — Batches was never part of the
 * Claude Design project (see docs/design/README.md). Built from the v3 system.
 *
 * The list answers "is the school's teaching capacity healthy" — who teaches
 * what, when it meets, how full it is, and whether attendance is holding up.
 * Opening one shows its roster, **weakest attendance first**, which is the
 * order `batchDetail()` already returns it in and the order a teacher
 * reviewing a batch actually wants.
 *
 * `findConflicts()` runs inside `batchDetail()`, so a double-booked teacher or
 * room surfaces here without this page checking anything itself. That check is
 * the service's, and it is why the detail view leads with conflicts rather
 * than burying them.
 *
 * **Creating and editing batches is not built here.** Both go through
 * `createBatch()` / `updateBatch()` with a conflict-override decision
 * (`allowConflicts`) that deserves a real form and a real confirm step —
 * `js/ui/form.js` and `js/ui/overlay.js` are still deliberately not copied in.
 * The buttons are present and disabled with an explanation. Closing and
 * reopening a batch are likewise left for that stage: `closeBatch()` takes a
 * `moveTo` target, because closing a batch strands its students otherwise.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on, debounce } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatNumber } from '../../utils/money.js';
import {
    listBatches, batchDetail, createBatch, updateBatch, closeBatch, WEEK
} from '../../services/batches.service.js';
import { availableTeachers } from '../../services/staff.service.js';
import { listBranches } from '../../services/settings.service.js';
import { curriculum, levelsOf, CAPABILITIES } from '../../config/app.config.js';
import { formModal, confirmModal } from '../../ui/form.js';
import { localDate } from '../../utils/date.js';

const DAY_LABELS = {
    Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday',
    Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday'
};

const FILTERS = [
    { key: null, label: 'Open' },
    { key: 'full', label: 'Full' },
    { key: 'empty', label: 'Empty' },
    { key: 'weak', label: 'Weak attendance' },
    { key: 'all', label: 'Include closed' }
];

export default class BatchesPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Batches';
        this.rows = [];
        this.filter = this.query.filter || null;
        this.search = '';
        this.detail = null;
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head v3-page-head-row">
                <div>
                    <h1 class="v3-page-title">Batches</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading…</p>
                </div>
                <div class="v3-head-actions">
                    <button class="v3-action-btn v3-btn-md" data-action="new-batch">
                        ${raw(icon('plus', { size: 14 }))} New batch
                    </button>
                </div>
            </div>
            <div class="v3-page-body">
                <div data-role="summary"></div>
                <section class="v3-filterbar">
                    <div class="v3-filter-row">
                        <label class="v3-search-field">
                            ${raw(icon('search', { size: 15 }))}
                            <span class="sr-only">Search batches</span>
                            <input type="search" data-role="search" placeholder="Search name, teacher, level…">
                        </label>
                    </div>
                    <div class="v3-chips" data-role="chips"></div>
                </section>
                <section class="v3-card" data-role="list">
                    <div class="v3-skeleton">Loading batches…</div>
                </section>
            </div>
            <div data-role="modal"></div>
        `);

        this.bind();
        await this.load();

        [EVENTS.BATCH_CREATED, EVENTS.BATCH_UPDATED, EVENTS.BATCH_CLOSED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    async load() {
        try {
            const rows = await listBatches(session.branch(), { includeClosed: this.filter === 'all' });
            if (this.disposed) return;
            this.rows = rows;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Batches failed to load', err);
            render(this.container.querySelector('[data-role="list"]'), html`
                <div class="v3-empty">Batches could not be loaded — ${err.message}</div>
            `);
        }
    }

    visibleRows() {
        const term = this.search.trim().toLowerCase();
        let rows = this.rows;

        if (this.filter === 'full') rows = rows.filter((b) => b.capacity && b.seatsLeft === 0);
        else if (this.filter === 'empty') rows = rows.filter((b) => !b.enrolled);
        else if (this.filter === 'weak') rows = rows.filter((b) => b.attendanceRate !== null && b.attendanceRate < 70);

        if (term) {
            rows = rows.filter((b) =>
                [b.name, b.code, b.teacherName, b.levelLabel, b.room]
                    .some((v) => String(v || '').toLowerCase().includes(term)));
        }
        return rows;
    }

    paint() {
        const rows = this.visibleRows();
        const seats = this.rows.reduce((s, b) => s + (b.capacity || 0), 0);
        const filled = this.rows.reduce((s, b) => s + (b.enrolled || 0), 0);
        const unstaffed = this.rows.filter((b) => !b.teacherId).length;

        render(this.container.querySelector('[data-role="subtitle"]'),
            `${rows.length} of ${this.rows.length} batch${this.rows.length === 1 ? '' : 'es'}`);

        render(this.container.querySelector('[data-role="summary"]'), html`
            <div class="v3-kpis">
                ${kpi('Batches', formatNumber(this.rows.length), 'neutral')}
                ${kpi('Students placed', formatNumber(filled), 'positive')}
                ${kpi('Seats free', seats ? formatNumber(Math.max(0, seats - filled)) : '—',
                      seats && filled >= seats ? 'caution' : 'neutral')}
                ${kpi('Without a teacher', formatNumber(unstaffed), unstaffed ? 'negative' : 'positive')}
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
                ${rows.map((b) => html`
                    <button class="v3-roll-row" data-action="open" data-id="${b.id}">
                        <span class="v3-roll-main">
                            <span class="v3-roll-name">
                                ${b.name}
                                ${b.status === 'closed' ? html`<span class="v3-chip" style="margin-left:8px;">closed</span>` : ''}
                            </span>
                            <span class="v3-roll-meta">
                                ${b.schedule || 'No schedule'} · ${b.teacherName}${b.room ? ` · ${b.room}` : ''}
                            </span>
                        </span>
                        <span class="v3-roll-badges">
                            ${b.attendanceRate !== null ? html`
                                <span class="v3-chip" data-fee="${b.attendanceRate >= 80 ? 'clear' : b.attendanceRate >= 65 ? 'due' : 'overdue'}">
                                    ${b.attendanceRate}%
                                </span>
                            ` : ''}
                            <span class="v3-chip" data-seats="${seatTone(b)}">${seatLabel(b)}</span>
                        </span>
                    </button>
                `)}
            </div>
        ` : html`<div class="v3-empty">No batch matches these filters.</div>`);
    }

    /* --------------------------------------------------------------- DETAIL */

    async open(id) {
        try {
            this.detail = await batchDetail(id);
            if (this.disposed) return;
            this.paintDetail();
        } catch (err) {
            toast.error(`Could not open that batch — ${err.message}`);
        }
    }

    close() {
        this.detail = null;
        render(this.container.querySelector('[data-role="modal"]'), '');
    }

    paintDetail() {
        const target = this.container.querySelector('[data-role="modal"]');
        if (!this.detail) { render(target, ''); return; }

        const { batch, teacher, conflicts, attendanceRate, roster } = this.detail;

        render(target, html`
            <div class="v3-modal-scrim" data-role="scrim">
                <div class="v3-modal" role="dialog" aria-modal="true" aria-label="${batch.name}">
                    <div class="v3-modal-head">
                        <div>
                            <h2 class="v3-modal-title">${batch.name}</h2>
                            <p class="v3-modal-sub">
                                ${batch.schedule || 'No schedule'}${batch.room ? ` · ${batch.room}` : ''} ·
                                ${teacher?.name || 'Unassigned'}
                            </p>
                        </div>
                        <button class="v3-modal-close" data-action="close-detail" aria-label="Close">
                            ${raw(icon('x', { size: 15 }))}
                        </button>
                    </div>

                    <div class="v3-modal-body">
                        ${conflicts?.length ? html`
                            <div class="v3-notice" data-tone="caution">
                                <strong>${conflicts.length} scheduling conflict${conflicts.length === 1 ? '' : 's'}.</strong>
                                ${conflicts.slice(0, 3).map((c) => html`
                                    <div class="v3-row-detail">${c.message || `${c.type || 'Clash'} with ${c.batch?.name || 'another batch'}`}</div>
                                `)}
                            </div>
                        ` : ''}

                        ${!batch.teacherId ? html`
                            <div class="v3-notice" data-tone="caution">
                                No teacher is assigned — this batch appears unstaffed on the timetable.
                            </div>
                        ` : ''}

                        <div class="v3-metrics">
                            ${metric('Enrolled', `${batch.enrolled}${batch.capacity ? ` / ${batch.capacity}` : ''}`)}
                            ${metric('Seats left', batch.seatsLeft === null ? 'No cap' : String(batch.seatsLeft))}
                            ${metric('Attendance, 60 days', attendanceRate === null ? '—' : `${attendanceRate}%`)}
                        </div>

                        <dl class="v3-facts">
                            ${fact('Level', batch.levelLabel || '—')}
                            ${fact('Meets', batch.schedule || '—')}
                            ${fact('Time', batch.startTime && batch.endTime ? `${batch.startTime}–${batch.endTime}` : '—')}
                            ${fact('Room', batch.room || '—')}
                            ${fact('Status', titleCase(batch.status || 'active'))}
                        </dl>

                        <h3 class="v3-card-title" style="font-size:var(--text-sm);">
                            Roster
                            <span class="v3-row-detail" style="font-weight:400;">
                                — weakest attendance first
                            </span>
                        </h3>
                        ${roster.length ? html`
                            <div class="v3-list" style="padding:0;">
                                ${roster.map((s) => html`
                                    <div class="v3-row">
                                        <div class="v3-row-main">
                                            <div class="v3-row-title">${s.name}</div>
                                            <div class="v3-row-detail">${s.admissionNo || ''}</div>
                                        </div>
                                        <span class="v3-chip" data-fee="${s.attendanceRate === null ? '' : s.attendanceRate >= 80 ? 'clear' : s.attendanceRate >= 65 ? 'due' : 'overdue'}">
                                            ${s.attendanceRate === null ? 'No marks' : `${s.attendanceRate}%`}
                                        </span>
                                    </div>
                                `)}
                            </div>
                        ` : html`<p class="v3-modal-note">Nobody is placed in this batch yet.</p>`}
                    </div>

                    <div class="v3-modal-foot">
                        <button class="v3-ghost-btn v3-btn-md" data-action="close-detail">Close</button>
                        ${batch.status === 'active' && session.can(CAPABILITIES.STUDENT_EDIT) ? html`
                            <button class="v3-ghost-btn v3-btn-md" data-action="close-batch">Close batch</button>
                        ` : ''}
                        ${session.can(CAPABILITIES.STUDENT_EDIT) ? html`
                            <button class="v3-action-btn v3-btn-md" data-action="edit-batch">Edit</button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `);
    }

    bind() {
        const root = this.container;

        this.onDispose(on(root, 'click', '[data-action="filter"]', (_e, t) => {
            const key = t.dataset.key || null;
            const next = this.filter === key ? null : key;
            const needsReload = next === 'all' || this.filter === 'all';
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

        this.onDispose(on(root, 'click', '[data-action="new-batch"]', () => this.newBatch()));
        this.onDispose(on(root, 'click', '[data-action="edit-batch"]', () => this.editBatch()));
        this.onDispose(on(root, 'click', '[data-action="close-batch"]', () => this.closeBatch()));

        this.onKey = (event) => { if (event.key === 'Escape' && this.detail) this.close(); };
        window.addEventListener('keydown', this.onKey);
        this.onDispose(() => window.removeEventListener('keydown', this.onKey));
    }

    /* ------------------------------------------------------------ CREATE/EDIT */

    /**
     * The batch form's fields. `existing` fills them for an edit.
     *
     * Teachers come from availableTeachers() rather than a plain staff list, so
     * a fully-booked teacher is *shown as such* instead of being silently
     * offered and then rejected by the conflict check a moment later.
     */
    async batchFields(existing = null) {
        const [teachers, branches] = await Promise.all([
            availableTeachers({ branchId: session.branch(), excludeBatchId: existing?.id || null }),
            listBranches()
        ]);

        // A batch must belong to a branch, so the form supplies one rather than
        // letting the service reject a create with none attached. With one
        // branch, or a branch already selected, this answers itself; with
        // several and "All branches" in view it is a real, required choice.
        const defaultBranchId = existing?.branchId
            || session.branch()
            || (branches.length === 1 ? branches[0].id : '');

        return [
            { name: 'name', label: 'Batch name', required: true, placeholder: 'Prarambhika Morning' },
            { name: 'code', label: 'Code', required: true, placeholder: 'PRA-M1', maxLength: 20,
              help: 'Short label used on registers and reports.' },
            { name: 'branchId', label: 'Branch', type: 'select', required: true,
              placeholder: branches.length > 1 ? 'Choose a branch' : null,
              options: branches.map((b) => ({ value: b.id, label: b.name })) },
            { name: 'levels', label: 'Levels', type: 'checks', required: true, itemNoun: 'level',
              options: curriculum().map((l) => ({ value: l.value, label: l.label })),
              help: 'Students at any of these levels can be placed here.' },
            { name: 'teacherId', label: 'Teacher', type: 'select', placeholder: 'Not assigned yet',
              options: teachers.map((t) => ({
                  value: t.id,
                  label: t.available
                      ? `${t.name} — ${t.load} batch${t.load === 1 ? '' : 'es'}`
                      : `${t.name} — busy (${t.clashWith})`
              })) },
            { name: 'days', label: 'Days', type: 'checks', required: true, itemNoun: 'day',
              options: WEEK.map((d) => ({ value: d, label: DAY_LABELS[d] || d })),
              help: 'The register only exists on these days.' },
            { name: 'startTime', label: 'Starts', type: 'time', required: true },
            { name: 'endTime', label: 'Ends', type: 'time', required: true,
              validate: (v, all) => (all.startTime && v <= all.startTime)
                  ? 'The batch cannot end before it starts.' : null },
            { name: 'room', label: 'Room or hall' },
            { name: 'capacity', label: 'Capacity', type: 'number', min: 0, max: 200,
              help: 'Leave blank for no limit.' },
            { name: 'startsOn', label: 'Running since', type: 'date' },
            { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 }
        ].map((f) => ({
            ...f,
            value: f.name === 'branchId' ? defaultBranchId
                 : f.name === 'levels'   ? (existing ? levelsOf(existing) : [])
                 : f.name === 'startsOn' ? (existing?.startsOn || localDate())
                 : existing?.[f.name]
        }));
    }

    /** Turns the field list into the `values` map formModal seeds itself from. */
    static seed(fields) {
        return Object.fromEntries(fields.map((f) => [f.name, f.value ?? (f.type === 'checks' ? [] : '')]));
    }

    async newBatch() {
        session.require('student.edit', 'create a batch');
        const fields = await this.batchFields();

        const created = await formModal({
            title: 'New batch',
            description: 'A batch fixes a set of levels, a teacher and a slot in the week.',
            fields,
            values: BatchesPage.seed(fields),
            submitLabel: 'Create batch',
            onSubmit: (values) => this.saveWithConflictCheck(
                (allowConflicts) => createBatch(values, { allowConflicts }))
        });

        if (created) {
            toast.success(`${created.batch.name} created.`);
            await this.load();
            this.open(created.batch.id);
        }
    }

    async editBatch() {
        const batch = this.detail?.batch;
        if (!batch) return;
        const fields = await this.batchFields(batch);

        const saved = await formModal({
            title: `Edit ${batch.name}`,
            fields,
            values: BatchesPage.seed(fields),
            submitLabel: 'Save changes',
            onSubmit: (values) => this.saveWithConflictCheck(
                (allowConflicts) => updateBatch(batch.id, values, { allowConflicts }))
        });

        if (saved) {
            toast.success('Batch updated.');
            this.close();
            await this.load();
        }
    }

    /**
     * The service refuses a clashing batch by throwing with the clashes
     * attached. Rather than swallowing that or making the user guess, show
     * exactly what it collides with and let them decide — a school does
     * sometimes mean it.
     *
     * Declining re-throws, which leaves the form open with everything still
     * typed and the clash shown against the submit button. That is the point:
     * the fix is to change a day, time, teacher or room, and all of those are
     * still on screen.
     */
    async saveWithConflictCheck(attempt) {
        try {
            return await attempt(false);
        } catch (err) {
            if (!err.conflicts?.length) throw err;

            const proceed = await confirmModal({
                title: 'This clashes with another batch',
                message: err.conflicts.map((c) => c.message).join(' '),
                confirmLabel: 'Schedule it anyway',
                tone: 'negative'
            });

            if (!proceed) throw err;
            return attempt(true);
        }
    }

    async closeBatch() {
        const batch = this.detail?.batch;
        if (!batch) return;

        const enrolled = this.detail.roster?.length || 0;
        const ok = await confirmModal({
            title: `Close ${batch.name}?`,
            message: enrolled
                ? `${enrolled} student${enrolled === 1 ? ' is' : 's are'} still enrolled. Closing stops new registers `
                  + 'from being created; it does not unenrol anyone or touch attendance already marked.'
                : 'Closing stops new registers from being created. Nothing already marked is affected.',
            confirmLabel: 'Close batch',
            tone: 'caution'
        });
        if (!ok) return;

        try {
            await closeBatch(batch.id);
            toast.success(`${batch.name} closed.`);
            this.close();
            await this.load();
        } catch (err) {
            toast.error(err.message);
        }
    }
}

/* ------------------------------------------------------------------ HELPERS */

function seatLabel(b) {
    if (!b.capacity) return `${b.enrolled} enrolled`;
    if (b.seatsLeft === 0) return 'Full';
    return `${b.seatsLeft} seat${b.seatsLeft === 1 ? '' : 's'} left`;
}

function seatTone(b) {
    if (!b.enrolled) return 'empty';
    if (b.capacity && b.seatsLeft === 0) return 'full';
    return 'open';
}

function kpi(label, value, tone) {
    return html`
        <div class="v3-kpi" data-tone="${tone}">
            <div style="flex:1;min-width:0;">
                <div class="v3-kpi-label">${label}</div>
                <div class="v3-kpi-value">${value}</div>
            </div>
        </div>
    `;
}

function metric(label, value) {
    return html`<div class="v3-metric"><div class="v3-metric-label">${label}</div><div class="v3-metric-value">${value}</div></div>`;
}

function fact(label, value) {
    return html`<div class="v3-fact"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function titleCase(value) {
    return String(value || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

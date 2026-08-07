/**
 * Natyam ERP v3 — Admin — Students
 *
 * Rebuilt for v3 from the approved design ("Students.dc.html", desktop half).
 * Two things about that design are deliberate and worth naming, because both
 * differ from what v2 did:
 *
 *   1. **The roll is a card list, not a data table.** The design replaced v2's
 *      full `<table>` with compact rows inside a single glass card — index,
 *      name, batch, then fee and status badges. This is why components.css
 *      still is not loaded by this app: there is no table to style.
 *   2. **The profile is a centred modal, not a right-side drawer.** The design
 *      project's own change log records this as a direct request ("replacing
 *      the app's real right-side drawer with a centered popup per direct
 *      request"), so it is not an accident of the mock.
 *
 * As everywhere else in v3, this page computes nothing that belongs to the
 * business: listStudents(), listFilters() and profile() all come from
 * students.service.js, carried over from the reference project unmodified.
 * The page decides presentation only.
 *
 * The operation buttons in the profile (Move batch, Collect fee, Promote,
 * Status, Issue certificate) and Edit/Archive/Delete are drawn per the design
 * but are **not wired yet** — each needs its own form or confirm flow, and
 * several depend on modules that have not been migrated (Fees, Certificates).
 * They are disabled with an explanation rather than shown as live buttons
 * that silently do nothing; see MIGRATION_CHECKLIST.md.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on, debounce } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatMoney } from '../../utils/money.js';
import { formatDateLong } from '../../utils/date.js';
import {
    listStudents, listFilters, profile, enrol, updateStudent,
    promote, setStatus, assignToBatch
} from '../../services/students.service.js';
import { listBatches } from '../../services/batches.service.js';
import { listBranches, listFeePlans } from '../../services/settings.service.js';
import { curriculum, levelsOf, levelLabel, CAPABILITIES, STUDENT_STATUS } from '../../config/app.config.js';
import { studentFormFields, seedStudentValues } from '../../config/studentFields.js';
import { formModal, confirmModal } from '../../ui/form.js';

/** The quick filters the design shows as pills. */
const QUICK_FILTERS = [
    { key: null, label: 'All' },
    { key: 'unplaced', label: 'Not in a batch' },
    { key: 'overdue', label: 'Fees overdue' },
    { key: 'at-risk', label: 'At risk' }
];

const PROFILE_TABS = ['Overview', 'Fees', 'Attendance', 'People', 'Records', 'History'];

/**
 * Operations the design draws on the profile.
 *
 * `action: null` means the module that owns it is not migrated yet — Fees'
 * collection dialog and the Certificates module are both Phase 2 — so those
 * two stay disabled with an explanation rather than being dropped from the row,
 * which would change the shape of a screen that has an approved design.
 */
const OPERATIONS = [
    { label: 'Move batch',        needs: CAPABILITIES.STUDENT_EDIT,      action: 'move-batch' },
    { label: 'Collect fee',       needs: CAPABILITIES.FEE_COLLECT,       action: null,
      why: 'Collecting a fee opens the payment dialog on the Fees screen.' },
    { label: 'Promote',           needs: CAPABILITIES.STUDENT_EDIT,      action: 'promote' },
    { label: 'Status',            needs: CAPABILITIES.STUDENT_EDIT,      action: 'set-status' },
    { label: 'Issue certificate', needs: CAPABILITIES.CERTIFICATE_ISSUE, action: null,
      why: 'Certificates arrive with their own module.' }
];

const STATUS_OPTIONS = [
    { value: STUDENT_STATUS.ACTIVE,    label: 'Active — attending' },
    { value: STUDENT_STATUS.ON_LEAVE,  label: 'On leave — coming back' },
    { value: STUDENT_STATUS.GRADUATED, label: 'Graduated — finished the course' },
    { value: STUDENT_STATUS.INACTIVE,  label: 'Inactive — no longer attending' }
];

export default class StudentsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Students';
        this.rows = [];
        this.filters = null;
        this.search = '';
        this.quick = this.query.filter || null;   // deep links: ?filter=unplaced
        this.level = null;
        this.batchId = null;
        this.filtersOpen = Boolean(this.quick);
        this.profile = null;
        this.profileTab = 'Overview';
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head v3-page-head-row">
                <div>
                    <h1 class="v3-page-title">Students</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading the roll…</p>
                </div>
                <div class="v3-head-actions">
                    <button class="v3-ghost-btn v3-btn-md" data-action="toggle-filters">
                        ${raw(icon('filter', { size: 14 }))} Filter
                    </button>
                    <!-- Disabled, not merely capability-gated: the student form does not
                         exist yet. A button that looks live and only raises a toast is worse
                         than one that plainly cannot be pressed. -->
                    <button class="v3-action-btn v3-btn-md" data-action="add">
                        ${raw(icon('plus', { size: 14 }))} Add student
                    </button>
                </div>
            </div>

            <div class="v3-page-body">
                <div data-role="filters"></div>
                <section class="v3-card" data-role="list">
                    <div class="v3-skeleton">Loading students…</div>
                </section>
            </div>

            <div data-role="modal"></div>
        `);

        this.bind();
        await this.load();

        [EVENTS.STUDENT_CREATED, EVENTS.STUDENT_UPDATED, EVENTS.STUDENT_REMOVED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    async load() {
        try {
            const branchId = session.branch();
            const [rows, filters] = await Promise.all([
                listStudents(branchId, { filter: this.quick, level: this.level, batchId: this.batchId }),
                this.filters ? Promise.resolve(this.filters) : listFilters(branchId)
            ]);
            if (this.disposed) return;

            this.rows = rows;
            this.filters = filters;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Students failed to load', err);
            render(this.container.querySelector('[data-role="list"]'), html`
                <div class="v3-empty">The roll could not be loaded — ${err.message}</div>
            `);
        }
    }

    /** Search is applied in the page, not the service — it is presentation. */
    visibleRows() {
        const term = this.search.trim().toLowerCase();
        if (!term) return this.rows;
        return this.rows.filter((row) =>
            [row.name, row.admissionNo, row.batchName, row.guardianName, row.guardianPhone]
                .some((value) => String(value || '').toLowerCase().includes(term)));
    }

    paint() {
        const rows = this.visibleRows();

        render(this.container.querySelector('[data-role="subtitle"]'),
            `${rows.length} of ${this.rows.length} student${this.rows.length === 1 ? '' : 's'}`);

        this.paintFilters();

        render(this.container.querySelector('[data-role="list"]'), rows.length ? html`
            <div class="v3-roll">
                ${rows.map((row, index) => html`
                    <button class="v3-roll-row" data-action="open" data-id="${row.id}">
                        <span class="v3-roll-index">${index + 1}</span>
                        <span class="v3-roll-main">
                            <span class="v3-roll-name">${row.name}</span>
                            <span class="v3-roll-meta">${row.batchName || 'Not in a batch'}${row.levelLabel ? ` · ${row.levelLabel}` : ''}</span>
                        </span>
                        <span class="v3-roll-badges">
                            <span class="v3-chip" data-fee="${row.feeState}">${feeLabel(row)}</span>
                            <span class="v3-chip" data-status="${row.status}">${statusLabel(row.status)}</span>
                        </span>
                    </button>
                `)}
            </div>
        ` : html`<div class="v3-empty">No student matches these filters.</div>`);
    }

    paintFilters() {
        const target = this.container.querySelector('[data-role="filters"]');
        if (!this.filtersOpen) { render(target, ''); return; }

        render(target, html`
            <section class="v3-filterbar">
                <div class="v3-filter-row">
                    <label class="v3-search-field">
                        ${raw(icon('search', { size: 15 }))}
                        <span class="sr-only">Search the roll</span>
                        <input type="search" data-role="search" value="${this.search}"
                               placeholder="Search name, admission no, guardian, phone…">
                    </label>
                </div>
                <div class="v3-chips">
                    ${QUICK_FILTERS.map((item) => html`
                        <button class="v3-pill" data-action="quick" data-key="${item.key || ''}"
                                aria-pressed="${this.quick === item.key ? 'true' : 'false'}">
                            ${item.label}
                        </button>
                    `)}
                </div>
                <div class="v3-filter-row">
                    <label class="v3-select-label">
                        <span>Level</span>
                        <select class="v3-branch-select" data-role="level">
                            <option value="">Any level</option>
                            ${(this.filters?.levels || []).map((l) => html`
                                <option value="${l.value}" ${this.level === l.value ? 'selected' : ''}>${l.label}</option>
                            `)}
                        </select>
                    </label>
                    <label class="v3-select-label">
                        <span>Batch</span>
                        <select class="v3-branch-select" data-role="batch">
                            <option value="">Any batch</option>
                            ${(this.filters?.batches || []).map((b) => html`
                                <option value="${b.value}" ${this.batchId === b.value ? 'selected' : ''}>${b.label}</option>
                            `)}
                        </select>
                    </label>
                </div>
            </section>
        `);
    }

    /* ---------------------------------------------------------- PROFILE */

    async openProfile(studentId) {
        try {
            this.profile = await profile(studentId);
            this.profileTab = 'Overview';
            if (this.disposed) return;
            this.paintProfile();
        } catch (err) {
            toast.error(`Could not open that student — ${err.message}`);
        }
    }

    closeProfile() {
        this.profile = null;
        render(this.container.querySelector('[data-role="modal"]'), '');
    }

    paintProfile() {
        const target = this.container.querySelector('[data-role="modal"]');
        if (!this.profile) { render(target, ''); return; }

        const { student, batch, fees, attendance, guardian, level } = this.profile;
        const tenureMonths = Math.max(0, Math.round((this.profile.tenureDays || 0) / 30));

        render(target, html`
            <div class="v3-modal-scrim" data-role="scrim">
                <div class="v3-modal" role="dialog" aria-modal="true" aria-label="${student.name}">
                    <div class="v3-modal-head">
                        <div>
                            <h2 class="v3-modal-title">${student.name}</h2>
                            <p class="v3-modal-sub">
                                ${student.admissionNo || '—'}${batch ? ` · ${batch.name}` : ' · Not in a batch'}${level ? ` · ${level.label}` : ''}
                            </p>
                        </div>
                        <button class="v3-modal-close" data-action="close-profile" aria-label="Close">
                            ${raw(icon('x', { size: 15 }))}
                        </button>
                    </div>

                    <div class="v3-ops">
                        ${OPERATIONS.filter((op) => session.can(op.needs)).map((op) => op.action ? html`
                            <button class="v3-action-btn v3-btn-sm" data-action="op" data-op="${op.action}">
                                ${op.label}
                            </button>
                        ` : html`
                            <button class="v3-action-btn v3-btn-sm" disabled title="${op.why}">
                                ${op.label}
                            </button>
                        `)}
                    </div>

                    <div class="v3-tabs" role="tablist">
                        ${PROFILE_TABS.map((tab) => html`
                            <button class="v3-tab" data-action="tab" data-tab="${tab}" role="tab"
                                    aria-selected="${this.profileTab === tab ? 'true' : 'false'}">${tab}</button>
                        `)}
                    </div>

                    <div class="v3-modal-body">
                        ${this.profileTab === 'Overview' ? html`
                            <div class="v3-metrics">
                                ${metric('Attendance, 90 days', attendance.recentRate === null ? '—' : `${attendance.recentRate}%`)}
                                ${metric('Fees outstanding', formatMoney(fees?.outstanding || 0))}
                                ${metric('With the school', `${tenureMonths} months`)}
                            </div>
                            ${!student.batchId ? html`
                                <div class="v3-notice" data-tone="caution">Not in a batch — appears on no register.</div>
                            ` : ''}
                            ${student.medicalNotes ? html`
                                <div class="v3-notice" data-tone="info"><strong>Medical note:</strong> ${student.medicalNotes}</div>
                            ` : ''}
                            <dl class="v3-facts">
                                ${fact('Level', level?.label || '—')}
                                ${fact('Batch', batch?.name || 'Not in a batch')}
                                ${fact('Status', statusLabel(student.status))}
                                ${fact('Joined', student.joinedOn ? formatDateLong(student.joinedOn) : '—')}
                            </dl>
                        ` : ''}

                        ${this.profileTab === 'Fees' ? html`
                            <div class="v3-metrics">
                                ${metric('Billed', formatMoney(fees?.billed || 0))}
                                ${metric('Collected', formatMoney(fees?.collected || 0))}
                                ${metric('Outstanding', formatMoney(fees?.outstanding || 0))}
                            </div>
                            ${fees?.receipts?.length ? html`
                                <dl class="v3-facts">
                                    ${fees.receipts.slice(0, 8).map((receipt) => fact(
                                        `${receipt.receiptNo} · ${receipt.mode || ''}`, formatMoney(receipt.amount || 0)))}
                                </dl>
                            ` : html`<p class="v3-modal-note">No payments recorded yet.</p>`}
                        ` : ''}

                        ${this.profileTab === 'Attendance' ? html`
                            <div class="v3-metrics">
                                ${metric('All time', attendance.rate === null ? '—' : `${attendance.rate}%`)}
                                ${metric('Last 90 days', attendance.recentRate === null ? '—' : `${attendance.recentRate}%`)}
                                ${metric('Last seen', attendance.lastSeen ? formatDateLong(attendance.lastSeen) : '—')}
                            </div>
                        ` : ''}

                        ${this.profileTab === 'People' ? html`
                            <dl class="v3-facts">
                                ${fact('Name', guardian?.name || '—')}
                                ${fact('Relationship', guardian?.relation || '—')}
                                ${fact('Phone', guardian?.phone || '—')}
                                ${fact('Email', guardian?.email || '—')}
                            </dl>
                        ` : ''}

                        ${this.profileTab === 'Records' ? (this.profile.certificates?.length ? html`
                            <dl class="v3-facts">
                                ${this.profile.certificates.map((cert) => fact(cert.title || 'Certificate', cert.serial || ''))}
                            </dl>
                        ` : html`<p class="v3-modal-note">No certificates issued yet.</p>`) : ''}

                        ${this.profileTab === 'History' ? (this.profile.timeline?.length ? html`
                            <div class="v3-list" style="padding:0;">
                                ${this.profile.timeline.map((event) => html`
                                    <div class="v3-row">
                                        <span class="v3-dot"></span>
                                        <div class="v3-row-main">
                                            <div class="v3-row-title">${event.title}</div>
                                            <div class="v3-row-detail">
                                                ${formatDateLong(event.at)}${event.detail ? ` · ${event.detail}` : ''}
                                            </div>
                                        </div>
                                    </div>
                                `)}
                            </div>
                        ` : html`<p class="v3-modal-note">Nothing recorded yet.</p>`) : ''}
                    </div>

                    <div class="v3-modal-foot">
                        <button class="v3-ghost-btn v3-btn-md" data-action="close-profile">Close</button>
                        ${session.can(CAPABILITIES.STUDENT_EDIT) ? html`
                            <button class="v3-action-btn v3-btn-md" data-action="edit-student">Edit</button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `);
    }

    /* ----------------------------------------------------------- EVENTS */

    bind() {
        const root = this.container;

        this.onDispose(on(root, 'click', '[data-action="toggle-filters"]', () => {
            this.filtersOpen = !this.filtersOpen;
            this.paintFilters();
        }));

        this.onDispose(on(root, 'click', '[data-action="quick"]', (_e, target) => {
            const key = target.dataset.key || null;
            this.quick = this.quick === key ? null : key;
            this.load();
        }));

        this.onDispose(on(root, 'input', '[data-role="search"]', debounce((_e, target) => {
            this.search = target.value;
            this.paint();
            // paint() replaced the field; restore focus and caret.
            const field = root.querySelector('[data-role="search"]');
            if (field && document.activeElement !== field) {
                field.focus();
                field.setSelectionRange(field.value.length, field.value.length);
            }
        }, 180)));

        this.onDispose(on(root, 'change', '[data-role="level"]', (_e, target) => {
            this.level = target.value || null;
            this.load();
        }));
        this.onDispose(on(root, 'change', '[data-role="batch"]', (_e, target) => {
            this.batchId = target.value || null;
            this.load();
        }));

        this.onDispose(on(root, 'click', '[data-action="open"]', (_e, target) => this.openProfile(target.dataset.id)));

        this.onDispose(on(root, 'click', '[data-action="close-profile"]', () => this.closeProfile()));
        // The backdrop dismisses — but ONLY on a direct hit. The scrim is the
        // dialog's *parent*, so a click on anything inside the dialog bubbles
        // through it, and the delegated closest() match would resolve to the
        // scrim and close the modal. That is exactly what happened: clicking a
        // tab, a form field or the Collect button silently dismissed the
        // dialog. Comparing event.target to the matched element distinguishes
        // "clicked the backdrop" from "clicked something the backdrop
        // contains". A stopPropagation() guard does NOT work here — both
        // handlers are delegated on the same root node, so the event has
        // already reached it.
        this.onDispose(on(root, 'click', '[data-role="scrim"]', (event, target) => {
            if (event.target !== target) return;
            this.closeProfile();
        }));

        this.onDispose(on(root, 'click', '[data-action="tab"]', (_e, target) => {
            this.profileTab = target.dataset.tab;
            this.paintProfile();
        }));

        this.onDispose(on(root, 'click', '[data-action="add"]', () => this.newStudent()));
        this.onDispose(on(root, 'click', '[data-action="edit-student"]', () => this.editStudent()));
        this.onDispose(on(root, 'click', '[data-action="op"]', (_e, t) => this.operation(t.dataset.op)));

        this.onKey = (event) => { if (event.key === 'Escape' && this.profile) this.closeProfile(); };
        window.addEventListener('keydown', this.onKey);
        this.onDispose(() => window.removeEventListener('keydown', this.onKey));
    }

    /* ------------------------------------------------------------ ADD / EDIT */

    /**
     * The student form. Long, and deliberately so — this is the one screen
     * where the whole record is entered at once, so it is grouped under
     * dividers rather than split across a wizard the school would have to
     * click through for every walk-in.
     *
     * THE FIELDS THEMSELVES ARE NOT DECLARED HERE ANY MORE — UAT6 ENH-602.
     * `js/config/studentFields.js` owns them, and natyam-mobile's Students
     * screen and both apps' Admissions enrol step build from the same call, so
     * a field that is mandatory is mandatory on every surface and the sentence
     * shown when it is left blank is the same one everywhere. What this page
     * still decides is presentation and which lists to offer.
     *
     * Batches are fetched for EVERY branch, not `session.branch()`: the form's
     * own Branch field narrows them (UAT6 BUG-602), and a session filtered to
     * one branch must not stop somebody moving a student to another.
     *
     * NOT INCLUDED: the reference form's `curriculumId` field. Curriculum here
     * means a course of study owned by the Programmes module, which is Phase 2
     * (`/programmes` is still `load: null`), so there is no listCurricula() in
     * this app to populate it. `enrol()` accepts the record without one, and
     * it is assignable later. Added when Programmes is.
     */
    async studentFields(existing = null) {
        const [batches, feePlans, branches] = await Promise.all([
            listBatches(null),
            // includeInactive so a student already on a retired plan keeps it —
            // studentFormFields() hides every other retired plan (UAT6).
            listFeePlans({ includeInactive: true }),
            listBranches()
        ]);

        return studentFormFields({
            mode: existing ? 'edit' : 'add',
            existing,
            branches,
            batches,
            feePlans,
            defaultBranchId: session.branch() || ''
        });
    }

    async newStudent() {
        session.require(CAPABILITIES.STUDENT_EDIT, 'add a student');
        const fields = await this.studentFields();

        const result = await formModal({
            title: 'Add a student',
            description: 'Enrols directly, without an application.',
            fields,
            values: seedStudentValues(fields),
            submitLabel: 'Enrol student',
            onSubmit: (values) => enrol(values)
        });

        if (!result) return;

        toast.success(`${result.student.name} is on the roll.`);
        if (result.billing?.invoices?.length) {
            toast.info(`${result.billing.invoices.length} fee${result.billing.invoices.length === 1 ? '' : 's'} raised.`);
        }
        await this.load();
        this.openProfile(result.student.id);
    }

    async editStudent() {
        const student = this.profile?.student;
        if (!student) return;
        const fields = await this.studentFields(student);

        const saved = await formModal({
            title: `Edit ${student.name}`,
            // Named here rather than left to the Batch field's own help text:
            // changing the branch is the one edit that forces a second answer,
            // and it is better said before somebody discovers it (UAT6 BUG-602).
            description: 'Changing the branch means choosing a batch at the new one.',
            fields,
            values: seedStudentValues(fields),
            submitLabel: 'Save changes',
            onSubmit: (values) => updateStudent(student.id, values)
        });

        if (!saved) return;
        toast.success('Student updated.');
        this.profile = await profile(student.id);
        this.paintProfile();
        await this.load();
    }

    /* ------------------------------------------------------------ OPERATIONS */

    operation(key) {
        if (key === 'move-batch') return this.moveBatch();
        if (key === 'promote') return this.promoteStudent();
        if (key === 'set-status') return this.changeStatus();
    }

    /** Refreshes the open profile and the list behind it after any write. */
    async refreshAfterOperation(studentId) {
        this.profile = await profile(studentId);
        this.paintProfile();
        await this.load();
    }

    /**
     * Moves a student between batches.
     *
     * "Take them off every batch" is gone from the placeholder — UAT6. It was
     * the shortest route to the record BUG-602 forbids: a student attending and
     * billed, on no register. `assignToBatch()` now refuses it for an active
     * student outright, so offering it here would only produce a rejection.
     * Somebody who has stopped attending is handled by Status, which clears the
     * batch itself, and the help text says so.
     *
     * Batches are fetched for every branch and then narrowed to the student's
     * own, so a move cannot silently relocate them to another site — matching
     * natyam-mobile, which has always done this.
     */
    async moveBatch() {
        const student = this.profile?.student;
        if (!student) return;

        const batches = (await listBatches(null))
            .filter((b) => b.status !== 'closed')
            .filter((b) => !student.branchId || b.branchId === student.branchId);

        const moved = await formModal({
            title: `Move ${student.name}`,
            description: 'A student with no batch appears on no register, so a batch has to be chosen.',
            submitLabel: 'Move',
            fields: [
                { name: 'batchId', label: 'Batch', type: 'select', required: true,
                  placeholder: 'Choose a batch',
                  options: batches.map((b) => ({
                      value: b.id,
                      label: `${b.name} — ${b.enrolled}/${b.capacity || '∞'}`
                           + (b.capacity && b.enrolled >= b.capacity ? ' (full)' : '')
                  })),
                  help: 'Only batches at this student’s branch. The service refuses one that is '
                      + 'full or that does not teach their level. To take them off the register '
                      + 'altogether, use Status instead.' }
            ],
            values: { batchId: student.batchId || '' },
            onSubmit: (v) => assignToBatch(student.id, v.batchId)
        });

        if (!moved) return;
        toast.success('Batch updated', student.name);
        await this.refreshAfterOperation(student.id);
    }

    /**
     * Moves a student up one level, and into the class that teaches it.
     *
     * THE NEW BATCH IS PART OF THE PROMOTION — UAT6. `promote()` used to clear
     * the batch and leave the student active, which is precisely the record
     * BUG-602 says must not exist, and it produced one on every promotion. The
     * destination is asked for here instead, filtered to batches that actually
     * teach the next level, so the student never spends a moment unplaced.
     *
     * When nothing teaches the next level the dialog does not open: there is no
     * answer to give it, and the honest thing to say is that the class has to
     * exist first.
     */
    async promoteStudent() {
        const student = this.profile?.student;
        if (!student) return;

        const ladder = curriculum();
        const index = ladder.findIndex((l) => l.value === student.level);
        const next = index >= 0 ? ladder[index + 1] : null;

        // The service throws for both of these. Checking first turns a rejected
        // submit into a dialog that never opens with a pointless form in it.
        if (!next) {
            toast.error(
                index === -1 ? 'Unrecognised level' : 'Already at the final level',
                index === -1
                    ? `${student.name} is at a level that is no longer in the curriculum.`
                    : `${student.name} has completed ${ladder[index].label}. Issue a diploma instead.`);
            return;
        }

        const destinations = (await listBatches(null))
            .filter((b) => b.status !== 'closed')
            .filter((b) => !student.branchId || b.branchId === student.branchId)
            .filter((b) => levelsOf(b).includes(next.value));

        if (!destinations.length) {
            toast.error(`No batch teaches ${next.label} yet`,
                `${student.name} cannot be promoted into a class that is not running. `
                + `Create or reopen a ${next.label} batch at their branch first.`);
            return;
        }

        const done = await formModal({
            title: `Promote ${student.name}`,
            description: `${ladder[index].label} → ${next.label}. They move straight into the batch `
                       + 'chosen below, so they are never off a register.',
            submitLabel: 'Promote',
            fields: [
                { name: 'batchId', label: `Batch at ${next.label}`, type: 'select', required: true,
                  placeholder: 'Choose a batch',
                  options: destinations.map((b) => ({
                      value: b.id,
                      label: `${b.name} — ${b.enrolled}/${b.capacity || '∞'}`
                           + (b.capacity && b.enrolled >= b.capacity ? ' (full)' : '')
                  })),
                  help: `Only batches teaching ${next.label} at this student’s branch.` },
                { name: 'note', label: 'Note', type: 'textarea', rows: 2,
                  help: 'Optional. Kept on the record as the reason for the promotion.' }
            ],
            values: { batchId: '', note: '' },
            onSubmit: (v) => promote(student.id, { batchId: v.batchId, note: v.note })
        });

        if (!done) return;
        toast.success('Promoted', `${student.name} is now at ${done.to.label}, in ${done.batch.name}.`);
        await this.refreshAfterOperation(student.id);
    }

    /**
     * Changes whether a student is attending.
     *
     * Leaving (Inactive or Graduated) requires a reason — the service insists,
     * because it is the only history of why — and also clears their batch.
     * `setStatus()` reports any outstanding balance back rather than cancelling
     * it: whether a leaver still owes money is a decision for a person, so this
     * surfaces the figure instead of swallowing it.
     *
     * COMING BACK asks for the batch they are returning to — UAT6, the other
     * half of the invariant. A leaver's batch was cleared when they left, so
     * setting them Active again would otherwise put an attending student on no
     * register. Only asked when there is genuinely nothing to go back to: a
     * student On leave keeps their batch and is never asked.
     */
    async changeStatus() {
        const student = this.profile?.student;
        if (!student) return;

        const leaving = (s) => s === STUDENT_STATUS.INACTIVE || s === STUDENT_STATUS.GRADUATED;
        const returning = (s) => s === STUDENT_STATUS.ACTIVE && !student.batchId;

        const batches = student.batchId ? [] : (await listBatches(null))
            .filter((b) => b.status !== 'closed')
            .filter((b) => !student.branchId || b.branchId === student.branchId)
            .filter((b) => levelsOf(b).includes(student.level));

        const result = await formModal({
            title: `${student.name}'s status`,
            description: `Currently ${statusLabel(student.status)}.`,
            submitLabel: 'Save status',
            fields: [
                { name: 'status', label: 'Status', type: 'select', required: true,
                  reactive: true, options: STATUS_OPTIONS },
                { name: 'reason', label: 'Why', type: 'textarea', rows: 2,
                  showIf: (v) => leaving(v.status),
                  help: 'Required when someone leaves — it is the only record of why. '
                      + 'They also come off their batch.' },
                { name: 'batchId', label: 'Returning to which batch?', type: 'select',
                  placeholder: 'Choose a batch',
                  showIf: (v) => returning(v.status),
                  options: batches.map((b) => ({
                      value: b.id,
                      label: `${b.name} — ${b.enrolled}/${b.capacity || '∞'}`
                           + (b.capacity && b.enrolled >= b.capacity ? ' (full)' : '')
                  })),
                  help: 'They came off their batch when they left. Only batches teaching '
                      + `${levelLabel(student.level) || 'their level'} at their branch.` }
            ],
            values: { status: student.status || STUDENT_STATUS.ACTIVE, reason: '', batchId: '' },
            validateAll: (v) => {
                if (leaving(v.status) && !String(v.reason || '').trim()) {
                    return { reason: 'Record why the student is leaving.' };
                }
                if (returning(v.status) && !v.batchId) {
                    return batches.length
                        ? { batchId: 'Choose the batch they are returning to.' }
                        : { status: `No batch at their branch teaches ${levelLabel(student.level) || 'their level'}. `
                                  + 'Open one before bringing them back.' };
                }
                return null;
            },
            onSubmit: (v) => setStatus(student.id, v.status, { reason: v.reason, batchId: v.batchId || null })
        });

        if (!result) return;
        toast.success('Status updated', statusLabel(result.student.status));
        if (result.outstanding > 0) {
            toast.info(
                `${formatMoney(result.outstanding)} still outstanding`,
                'Their invoices were left alone — settle or waive them on the Fees screen.');
        }
        await this.refreshAfterOperation(student.id);
    }
}

/* ------------------------------------------------------------------ HELPERS */

function metric(label, value) {
    return html`<div class="v3-metric"><div class="v3-metric-label">${label}</div><div class="v3-metric-value">${value}</div></div>`;
}

function fact(label, value) {
    return html`<div class="v3-fact"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function feeLabel(row) {
    if (row.overdue > 0) return `${formatMoney(row.overdue)} overdue`;
    if (row.outstanding > 0) return `${formatMoney(row.outstanding)} due`;
    return 'Paid up';
}

function statusLabel(status) {
    return String(status || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

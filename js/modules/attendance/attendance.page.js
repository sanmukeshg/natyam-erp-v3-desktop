/**
 * Natyam ERP v3 — Admin — Attendance
 *
 * The register. Two views in one page, as in v2:
 *
 *   1. **The day board** — every batch meeting on a date, with whether its
 *      register is done, who teaches it, and what the rate was.
 *   2. **The register itself** — one batch's roster, marked and posted.
 *
 * NO APPROVED v3 DESIGN EXISTS FOR THIS SCREEN. The Claude Design project was
 * deleted before `Attendance.dc.html` could be retrieved (see
 * docs/design/README.md). This screen is therefore built from two things that
 * *are* settled, rather than invented:
 *
 *   - **The interaction is ported, not designed.** v2's attendance page was
 *     deliberately built "for one-handed speed: everybody starts present,
 *     marking is one tap." That rule is preserved exactly, along with the
 *     All present / All absent bulk actions. A teacher who used v2 does not
 *     have to relearn anything.
 *   - **The visual language is the implemented v3 system** in
 *     assets/css/v3.css, already proven on Dashboard and Students.
 *
 * If `Attendance.dc.html` is ever recovered or regenerated, this is the file
 * to reconcile against it — the business logic underneath is untouched, so
 * that would be a markup-and-CSS change.
 *
 * As everywhere in v3, this computes nothing: openRegister(), dayBoard(),
 * postRegister(), markingWindow() and missingRegisters() all come from
 * attendance.service.js, carried over from the reference project unmodified.
 * In particular the marking-window rule (no future dates, nothing older than
 * 30 days) is the service's, asked before the UI offers to save rather than
 * re-implemented here.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { localDate, addDays, formatDateLong } from '../../utils/date.js';
import { ATTENDANCE_STATUS, CAPABILITIES } from '../../config/app.config.js';
import {
    dayBoard, openRegister, postRegister, markingWindow, missingRegisters
} from '../../services/attendance.service.js';
import { postponeSession, cancelSession } from '../../services/session.service.js';
import { availableTeachers } from '../../services/staff.service.js';
import { formModal, confirmModal } from '../../ui/form.js';

const STATE_LABEL = {
    marked: 'Register marked',
    running: 'In progress',
    missed: 'Not marked',
    upcoming: 'Later today'
};

export default class AttendancePage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Attendance';
        this.date = this.query.date || localDate();
        // Timetable links straight at one class's register (?batch=…&date=…),
        // which is the normal way in now that Attendance is hidden from the
        // sidebar again. Held here and consumed once, on first load, so a
        // later "All classes" genuinely returns to the day board rather than
        // bouncing back into the register.
        this.pendingBatchId = this.query.batch || null;
        this.board = null;
        this.missing = [];
        // The open register, or null when showing the day board. `entries` is
        // mutated in place as the user taps; nothing is written until Save.
        this.register = null;
        this.saving = false;
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head v3-page-head-row">
                <div>
                    <h1 class="v3-page-title">Attendance</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading…</p>
                </div>
                <div class="v3-head-actions" data-role="head-actions"></div>
            </div>
            <div class="v3-page-body" data-role="body">
                <div class="v3-skeleton">Loading the register…</div>
            </div>
        `);

        this.bind();
        await this.loadBoard();

        this.events.on(EVENTS.BRANCH_CHANGED, () => { this.register = null; this.loadBoard(); });
    }

    /* ------------------------------------------------------------ DAY BOARD */

    async loadBoard() {
        try {
            const branchId = session.branch();
            const [board, missing] = await Promise.all([
                dayBoard(this.date, branchId),
                missingRegisters({ branchId }).catch(() => [])
            ]);
            if (this.disposed) return;
            this.board = board;
            this.missing = missing;

            // Deep link from the Timetable: open that class's register
            // directly. Cleared first so it fires exactly once.
            if (this.pendingBatchId) {
                const batchId = this.pendingBatchId;
                this.pendingBatchId = null;
                await this.open(batchId, this.date);
                return;
            }

            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Attendance failed to load', err);
            render(this.container.querySelector('[data-role="body"]'), html`
                <div class="v3-error">The day's classes could not be loaded — ${err.message}</div>
            `);
        }
    }

    paint() {
        if (this.register) { this.paintRegister(); return; }

        const batches = this.board?.batches || [];
        const done = batches.filter((b) => b.done).length;
        const rule = markingWindow(this.date);

        render(this.container.querySelector('[data-role="subtitle"]'),
            `${formatDateLong(this.date)} · ${done} of ${batches.length} register${batches.length === 1 ? '' : 's'} marked`);

        render(this.container.querySelector('[data-role="head-actions"]'), html`
            <button class="v3-ghost-btn v3-btn-md" data-action="day" data-delta="-1"
                    aria-label="Previous day">${raw(icon('chevron-left', { size: 14 }))}</button>
            <label class="v3-select-label">
                <span class="sr-only">Date</span>
                <input class="v3-branch-select" type="date" data-role="date" value="${this.date}">
            </label>
            <button class="v3-ghost-btn v3-btn-md" data-action="day" data-delta="1"
                    aria-label="Next day">${raw(icon('chevron-right', { size: 14 }))}</button>
            <button class="v3-ghost-btn v3-btn-md" data-action="today">Today</button>
        `);

        render(this.container.querySelector('[data-role="body"]'), html`
            ${rule.markable ? '' : html`
                <div class="v3-notice" data-tone="caution">${rule.message}</div>
            `}

            ${this.missing.length ? html`
                <section class="v3-card">
                    <div class="v3-card-head">
                        <h2 class="v3-card-title">
                            Missing registers
                            <span class="v3-chip" style="margin-left:8px;">${this.missing.length}</span>
                        </h2>
                        <p class="v3-card-note">Classes that met but were never marked, in the last 30 days.</p>
                    </div>
                    <div class="v3-list">
                        ${this.missing.slice(0, 8).map((row) => html`
                            <div class="v3-row">
                                <span class="v3-dot" data-severity="${row.age > 3 ? 'medium' : 'low'}"></span>
                                <div class="v3-row-main">
                                    <div class="v3-row-title">${row.batch?.name || 'A class'}</div>
                                    <div class="v3-row-detail">${formatDateLong(row.date)}</div>
                                </div>
                                <button class="v3-ghost-btn" data-action="open"
                                        data-batch="${row.batch?.id}" data-date="${row.date}">Mark</button>
                            </div>
                        `)}
                    </div>
                </section>
            ` : ''}

            <section class="v3-card">
                <div class="v3-card-head">
                    <h2 class="v3-card-title">Classes on this day</h2>
                </div>
                ${batches.length ? html`
                    <div class="v3-roll">
                        ${batches.map((batch) => html`
                            <button class="v3-roll-row" data-action="open"
                                    data-batch="${batch.id}" data-date="${this.date}">
                                <span class="v3-roll-main">
                                    <span class="v3-roll-name">${batch.name}</span>
                                    <span class="v3-roll-meta">
                                        ${batch.startTime}–${batch.endTime} · ${batch.teacherName} ·
                                        ${batch.expected} student${batch.expected === 1 ? '' : 's'}
                                    </span>
                                </span>
                                <span class="v3-roll-badges">
                                    <span class="v3-badge" data-state="${batch.done ? 'marked' : 'missed'}">
                                        ${batch.done ? `${batch.rate}% present` : 'Not marked'}
                                    </span>
                                </span>
                            </button>
                        `)}
                    </div>
                ` : html`<div class="v3-empty">No classes are scheduled on this day.</div>`}
            </section>
        `);
    }

    /* -------------------------------------------------------------- REGISTER */

    async open(batchId, date) {
        try {
            this.register = await openRegister(batchId, date);
            this.date = date;
            if (this.disposed) return;
            this.paintRegister();
        } catch (err) {
            toast.error(`Could not open that register — ${err.message}`);
        }
    }

    close() {
        this.register = null;
        this.loadBoard();
    }

    paintRegister() {
        const reg = this.register;
        const rule = markingWindow(reg.date);
        const canMark = session.can('attendance.mark') && rule.markable;
        const present = reg.entries.filter((e) => e.status === ATTENDANCE_STATUS.PRESENT).length;

        render(this.container.querySelector('[data-role="subtitle"]'),
            `${reg.batch.name} · ${formatDateLong(reg.date)}`);

        render(this.container.querySelector('[data-role="head-actions"]'), html`
            <button class="v3-ghost-btn v3-btn-md" data-action="back">
                ${raw(icon('arrow-left', { size: 14 }))} All classes
            </button>
        `);

        render(this.container.querySelector('[data-role="body"]'), html`
            ${!reg.scheduled ? html`
                <div class="v3-notice" data-tone="caution">
                    ${reg.batch.name} does not normally meet on ${reg.dayName}. You can still
                    mark it — a session will be recorded for this date.
                </div>
            ` : ''}
            ${reg.sessionStatus === 'cancelled' ? html`
                <div class="v3-notice" data-tone="caution">This class was cancelled.</div>
            ` : ''}
            ${reg.postponedFrom ? html`
                <div class="v3-notice" data-tone="info">
                    Moved from ${formatDateLong(reg.postponedFrom)}.
                </div>
            ` : ''}
            ${!rule.markable ? html`<div class="v3-notice" data-tone="caution">${rule.message}</div>` : ''}
            ${reg.alreadyMarked ? html`
                <div class="v3-notice" data-tone="info">
                    Already marked. Saving again will correct the existing register.
                </div>
            ` : ''}

            <section class="v3-card">
                <div class="v3-card-head v3-register-head">
                    <div>
                        <h2 class="v3-card-title">${reg.batch.name}</h2>
                        <p class="v3-card-note" data-role="tally">
                            ${present} present · ${reg.entries.length - present} absent
                        </p>
                    </div>
                    <div class="v3-head-actions">
                        <button class="v3-ghost-btn v3-btn-md" data-action="all" data-status="present"
                                ${canMark ? '' : 'disabled'}>All present</button>
                        <button class="v3-ghost-btn v3-btn-md" data-action="all" data-status="absent"
                                ${canMark ? '' : 'disabled'}>All absent</button>
                    </div>
                </div>

                ${reg.empty ? html`
                    <div class="v3-empty">Nobody is in this batch yet, so there is nothing to mark.</div>
                ` : html`
                    <div class="v3-register" data-role="roster">
                        ${reg.entries.map((entry) => this.entryRow(entry, canMark))}
                    </div>
                `}
            </section>

            ${reg.empty ? '' : html`
                <div class="v3-register-bar">
                    <div class="v3-register-hint">
                        Everyone starts present — tap only the students who are absent.
                    </div>
                    <button class="v3-action-btn v3-btn-md" data-action="save"
                            ${canMark && !this.saving ? '' : 'disabled'}>
                        ${this.saving ? 'Saving…' : reg.alreadyMarked ? 'Save corrections' : 'Save register'}
                    </button>
                </div>
            `}

            <section class="v3-card">
                <div class="v3-card-head"><h2 class="v3-card-title">This class</h2></div>
                <div class="v3-card-body v3-head-actions">
                    ${session.can(CAPABILITIES.STUDENT_EDIT) ? html`
                        <button class="v3-action-btn v3-btn-sm" data-action="postpone">Postpone</button>
                        <button class="v3-action-btn v3-btn-sm" data-action="cancel-class">Cancel class</button>
                    ` : ''}
                    <a class="v3-ghost-btn v3-btn-sm" href="#/timetable?batch=${reg.batch.id}">Class calendar</a>
                </div>
                <p class="v3-modal-note" style="padding:0 var(--space-6) var(--space-4);">
                    Postponing keeps this class on record and links it to its replacement.
                    Neither postponing nor cancelling touches attendance already marked.
                </p>
            </section>
        `);
    }

    /** One roster row. Kept as its own method so a single tap can re-render just this row. */
    entryRow(entry, canMark) {
        const absent = entry.status === ATTENDANCE_STATUS.ABSENT;
        return html`
            <button class="v3-mark" data-action="toggle" data-id="${entry.studentId}"
                    data-status="${entry.status}" aria-pressed="${absent ? 'true' : 'false'}"
                    ${canMark ? '' : 'disabled'}>
                <span class="v3-mark-main">
                    <span class="v3-mark-name">${entry.name}</span>
                    <span class="v3-mark-meta">
                        ${entry.admissionNo || ''}${entry.medicalNotes ? ' · has a medical note' : ''}
                    </span>
                </span>
                <span class="v3-mark-state">${absent ? 'Absent' : 'Present'}</span>
            </button>
        `;
    }

    /**
     * One tap flips one student. Only the tapped row and the tally are
     * re-rendered — repainting the whole roster on every tap loses scroll
     * position, which matters when a teacher is working down a list of forty.
     */
    toggle(studentId) {
        const entry = this.register?.entries.find((e) => e.studentId === studentId);
        if (!entry) return;

        entry.status = entry.status === ATTENDANCE_STATUS.ABSENT
            ? ATTENDANCE_STATUS.PRESENT
            : ATTENDANCE_STATUS.ABSENT;

        const node = this.container.querySelector(`.v3-mark[data-id="${studentId}"]`);
        if (node) {
            const absent = entry.status === ATTENDANCE_STATUS.ABSENT;
            node.dataset.status = entry.status;
            node.setAttribute('aria-pressed', absent ? 'true' : 'false');
            const state = node.querySelector('.v3-mark-state');
            if (state) state.textContent = absent ? 'Absent' : 'Present';
        }
        this.paintTally();
    }

    setAll(status) {
        if (!this.register) return;
        this.register.entries.forEach((entry) => { entry.status = status; });
        this.paintRegister();
    }

    paintTally() {
        const reg = this.register;
        if (!reg) return;
        const present = reg.entries.filter((e) => e.status === ATTENDANCE_STATUS.PRESENT).length;
        render(this.container.querySelector('[data-role="tally"]'),
            `${present} present · ${reg.entries.length - present} absent`);
    }

    async save() {
        if (!this.register || this.saving) return;
        this.saving = true;
        this.paintRegister();

        try {
            await postRegister({
                batchId: this.register.batch.id,
                date: this.register.date,
                entries: this.register.entries.map((e) => ({ studentId: e.studentId, status: e.status }))
            });
            toast.success('Register saved', `${this.register.batch.name} — ${formatDateLong(this.register.date)}`);
            this.saving = false;
            this.close();
        } catch (err) {
            this.saving = false;
            if (this.disposed) return;
            toast.error(`Could not save the register — ${err.message}`);
            this.paintRegister();
        }
    }

    /* ---------------------------------------------------------------- EVENTS */

    bind() {
        const root = this.container;

        this.onDispose(on(root, 'click', '[data-action="open"]', (_e, target) =>
            this.open(target.dataset.batch, target.dataset.date)));
        this.onDispose(on(root, 'click', '[data-action="back"]', () => this.close()));

        this.onDispose(on(root, 'click', '[data-action="day"]', (_e, target) => {
            this.date = addDays(this.date, Number(target.dataset.delta));
            this.loadBoard();
        }));
        this.onDispose(on(root, 'click', '[data-action="today"]', () => {
            this.date = localDate();
            this.loadBoard();
        }));
        this.onDispose(on(root, 'change', '[data-role="date"]', (_e, target) => {
            if (!target.value) return;
            this.date = target.value;
            this.loadBoard();
        }));

        this.onDispose(on(root, 'click', '[data-action="toggle"]', (_e, target) => this.toggle(target.dataset.id)));
        this.onDispose(on(root, 'click', '[data-action="all"]', (_e, target) =>
            this.setAll(target.dataset.status === 'present' ? ATTENDANCE_STATUS.PRESENT : ATTENDANCE_STATUS.ABSENT)));
        this.onDispose(on(root, 'click', '[data-action="save"]', () => this.save()));
        this.onDispose(on(root, 'click', '[data-action="postpone"]', () => this.postpone()));
        this.onDispose(on(root, 'click', '[data-action="cancel-class"]', () => this.cancelClass()));
    }

    /* ------------------------------------------------------- SESSION CHANGES */

    /**
     * Moves this class to another date.
     *
     * WHAT HAPPENS TO ATTENDANCE ALREADY MARKED: nothing. `postponeSession()`
     * never deletes the original — it marks it Postponed and keeps it linked to
     * its replacement "forever", in the service's own words — and it does not
     * touch the attendance collection at all. Marks stay against the date they
     * were taken on, which is the only answer that cannot lose a record of who
     * actually turned up. The screen says so rather than leaving it to be
     * discovered.
     */
    async postpone() {
        const reg = this.register;
        if (!reg) return;

        const teachers = await availableTeachers({ branchId: session.branch() }).catch(() => []);

        const moved = await formModal({
            title: `Postpone ${reg.batch.name}`,
            description: `Currently ${formatDateLong(reg.date)}. The original stays on record, `
                       + 'linked to its replacement.',
            submitLabel: 'Postpone class',
            fields: [
                { name: 'newDate', label: 'New date', type: 'date', required: true,
                  validate: (v) => v === reg.date ? 'That is the date it is already on.' : null },
                { name: 'newStartTime', label: 'Starts', type: 'time', required: true },
                { name: 'newEndTime', label: 'Ends', type: 'time', required: true,
                  validate: (v, all) => all.newStartTime && v <= all.newStartTime
                      ? 'The replacement cannot end before it starts.' : null },
                { name: 'teacherId', label: 'Teacher', type: 'select',
                  placeholder: 'Keep the current teacher',
                  options: teachers.map((t) => ({ value: t.id, label: t.name })) },
                { name: 'reason', label: 'Why', required: true,
                  placeholder: 'Festival holiday, teacher unavailable…',
                  help: 'Recorded against both the original and the replacement.' },
                { name: 'remarks', label: 'Notes', type: 'textarea', rows: 2 }
            ],
            values: {
                newDate: '',
                newStartTime: reg.batch.startTime || '',
                newEndTime: reg.batch.endTime || '',
                teacherId: '', reason: '', remarks: ''
            },
            // postponeSession() resolves to { originalId, replacementId } — ids,
            // no date — so the new date is carried through from the form rather
            // than read off a field the result does not have.
            onSubmit: async (v) => ({ ...(await postponeSession(reg.batch.id, reg.date, v)), newDate: v.newDate })
        });

        if (!moved) return;
        toast.success('Class postponed', `${reg.batch.name} now meets on ${formatDateLong(moved.newDate)}.`);
        this.register = null;
        await this.loadBoard();
    }

    /** Cancels this class outright — no replacement. Marks already taken are untouched. */
    async cancelClass() {
        const reg = this.register;
        if (!reg) return;

        const marked = reg.entries.filter((e) => e.previouslyMarked).length;

        const cancelled = await formModal({
            title: `Cancel ${reg.batch.name}`,
            description: `${formatDateLong(reg.date)}. The class simply does not happen — `
                       + 'there is no replacement.',
            submitLabel: 'Cancel this class',
            fields: [
                ...(marked ? [{
                    type: 'divider',
                    label: `${marked} student${marked === 1 ? '' : 's'} already marked — those marks are kept`
                }] : []),
                { name: 'reason', label: 'Why', required: true,
                  placeholder: 'Venue unavailable, public holiday…' },
                { name: 'remarks', label: 'Notes', type: 'textarea', rows: 2 }
            ],
            values: { reason: '', remarks: '' },
            onSubmit: async (v) => {
                const ok = await confirmModal({
                    title: `Cancel ${reg.batch.name} on ${formatDateLong(reg.date)}?`,
                    message: marked
                        ? `${marked} student${marked === 1 ? '’s mark is' : 's’ marks are'} already recorded `
                          + 'for this class and will be kept. Cancelling cannot be undone from this screen.'
                        : 'Cancelling cannot be undone from this screen.',
                    confirmLabel: 'Cancel the class',
                    tone: 'negative'
                });
                if (!ok) throw new Error('Not cancelled. Nothing has changed.');
                await cancelSession(reg.batch.id, reg.date, v);
                return true;
            }
        });

        if (!cancelled) return;
        toast.success('Class cancelled', reg.batch.name);
        this.register = null;
        await this.loadBoard();
    }
}

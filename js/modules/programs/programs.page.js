/**
 * Natyam ERP v3 — Admin — Programmes
 *
 * Performances, workshops, competitions, examinations and rehearsals. In this
 * school these are not a side feature: the Annual Day rangapravesham is the
 * event the whole year is organised around, and a student's programme history
 * is what a certificate is issued against.
 *
 * "Events" and "programmes" are the same thing here and are modelled once —
 * one participant list, one calendar, one place for a date to be wrong. What
 * differs between a workshop and a competition is a `type` field.
 *
 * COMPLETING A PROGRAMME TOUCHES THE BOOKS. `complete()` posts the programme's
 * income and expenditure to the ledger through `finance.service.postEntry()`,
 * which is why that service was migrated alongside this one. The completion
 * dialog therefore asks for money, says where it goes, and is not reversible
 * from this screen — so it confirms first.
 *
 * NO DESIGN FILE (`Programmes.dc.html` was never generated — the design
 * project was deleted before Phase 2). Reuses the shapes Students, Parents and
 * Staff already established.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on, debounce } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatMoney, formatNumber } from '../../utils/money.js';
import { localDate, formatDateLong } from '../../utils/date.js';
import { CAPABILITIES, programTypes, curriculum, levelLabel } from '../../config/app.config.js';
import {
    PROGRAM_STATUS, listPrograms, programSummary, programDetail,
    schedule, updateProgram, complete, cancel, setParticipants, eligibleStudents
} from '../../services/programs.service.js';
import { listBranches } from '../../services/settings.service.js';
import { listStaff } from '../../services/staff.service.js';
import { formModal, confirmModal } from '../../ui/form.js';

const FILTERS = [
    { key: null, label: 'All' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: PROGRAM_STATUS.COMPLETED, label: 'Completed' },
    { key: PROGRAM_STATUS.CANCELLED, label: 'Cancelled' }
];

const TONE_FOR = {
    [PROGRAM_STATUS.SCHEDULED]: '',
    [PROGRAM_STATUS.RUNNING]: 'clear',
    [PROGRAM_STATUS.COMPLETED]: 'clear',
    [PROGRAM_STATUS.CANCELLED]: 'overdue'
};

export default class ProgramsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Programmes';
        this.filter = this.query.filter || null;
        this.search = '';
        this.rows = [];
        this.stats = null;
        this.detail = null;
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head">
                <div>
                    <h1 class="v3-page-title">Programmes</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading…</p>
                </div>
                <div class="v3-head-actions">
                    ${session.can(CAPABILITIES.PROGRAM_EDIT) ? html`
                        <button class="v3-action-btn v3-btn-md" data-action="new">
                            ${raw(icon('plus', { size: 14 }))} Schedule
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
                            <span class="sr-only">Search programmes</span>
                            <input type="search" data-role="search" placeholder="Search name, venue, type…">
                        </label>
                    </div>
                    <div class="v3-chips" data-role="chips"></div>
                </section>
                <section class="v3-card" data-role="list">
                    <div class="v3-skeleton">Loading programmes…</div>
                </section>
            </div>
            <div data-role="modal"></div>
        `);

        this.bind();
        await this.load();

        // There is no PROGRAM_CANCELLED event — cancel() emits PROGRAM_UPDATED,
        // like every other in-place change. Listening for a name that does not
        // exist would silently never fire.
        [EVENTS.PROGRAM_SCHEDULED, EVENTS.PROGRAM_UPDATED, EVENTS.PROGRAM_COMPLETED,
         EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    async load() {
        try {
            const [rows, stats] = await Promise.all([
                listPrograms(session.branch()),
                programSummary(session.branch())
            ]);
            if (this.disposed) return;
            this.rows = rows;
            this.stats = stats;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Programmes failed to load', err);
            render(this.container.querySelector('[data-role="list"]'), html`
                <div class="v3-empty">Programmes could not be loaded — ${err.message}</div>
            `);
        }
    }

    visibleRows() {
        let rows = this.rows.filter((p) => {
            if (this.filter === 'upcoming') return !p.isPast && p.status === PROGRAM_STATUS.SCHEDULED;
            if (this.filter) return p.status === this.filter;
            return true;
        });

        const term = this.search.trim().toLowerCase();
        if (term) {
            rows = rows.filter((p) =>
                [p.name, p.venue, p.typeLabel, p.branchName, p.leadName]
                    .some((v) => String(v || '').toLowerCase().includes(term)));
        }
        return rows;
    }

    paint() {
        const rows = this.visibleRows();
        const s = this.stats || {};

        render(this.container.querySelector('[data-role="subtitle"]'),
            `${rows.length} of ${this.rows.length} programme${this.rows.length === 1 ? '' : 's'}`);

        render(this.container.querySelector('[data-role="summary"]'), html`
            <div class="v3-kpis">
                ${kpi('Upcoming', formatNumber(s.upcoming || 0), s.upcoming ? 'caution' : 'neutral',
                      s.nextUp ? `Next: ${s.nextUp.name} on ${formatDateLong(s.nextUp.date)}` : 'Nothing scheduled')}
                ${kpi('This year', formatNumber(s.thisYear || 0), 'neutral',
                      `${formatNumber(s.completed || 0)} completed${s.cancelled ? `, ${s.cancelled} cancelled` : ''}`)}
                ${kpi('Students involved', formatNumber(s.participantsEngaged || 0), 'neutral',
                      'Distinct, this year')}
                ${kpi('Types run', formatNumber((s.byType || []).length), 'neutral',
                      (s.byType || []).map((t) => `${t.label} ${t.count}`).join(' · ') || '—')}
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
                ${rows.map((p) => html`
                    <button class="v3-roll-row" data-action="open" data-id="${p.id}">
                        <span class="v3-roll-main">
                            <span class="v3-roll-name">
                                ${p.name}
                                ${p.status !== PROGRAM_STATUS.SCHEDULED ? html`
                                    <span class="v3-chip" style="margin-left:8px;">${p.status}</span>
                                ` : ''}
                            </span>
                            <span class="v3-roll-meta">
                                ${p.typeLabel} · ${formatDateLong(p.date)}${p.venue ? ` · ${p.venue}` : ''}
                                ${p.leadName ? ` · ${p.leadName}` : ''}
                            </span>
                        </span>
                        ${p.daysAway !== null && p.status === PROGRAM_STATUS.SCHEDULED ? html`
                            <span class="v3-chip" data-fee="${p.daysAway <= 14 ? 'overdue' : ''}">
                                ${p.daysAway === 0 ? 'Today' : `in ${p.daysAway}d`}
                            </span>
                        ` : ''}
                        <span class="v3-chip" data-fee="${TONE_FOR[p.status] || ''}">
                            ${formatNumber(p.participantCount)} taking part
                        </span>
                    </button>
                `)}
            </div>
        ` : html`
            <div class="v3-empty">
                ${this.rows.length ? 'No programme matches that.' : 'Nothing scheduled yet.'}
            </div>
        `);

        this.paintDetail();
    }

    /* ---------------------------------------------------------------- DETAIL */

    async open(id) {
        try {
            this.detail = await programDetail(id);
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

        const p = d.program;
        const canEdit = session.can(CAPABILITIES.PROGRAM_EDIT);
        const live = p.status === PROGRAM_STATUS.SCHEDULED || p.status === PROGRAM_STATUS.RUNNING;

        render(target, html`
            <div class="v3-modal-scrim" data-role="scrim">
                <div class="v3-modal" role="dialog" aria-modal="true" aria-label="${p.name}">
                    <div class="v3-modal-head">
                        <div>
                            <h2 class="v3-modal-title">${p.name}</h2>
                            <p class="v3-modal-sub">
                                ${p.typeLabel} · ${formatDateLong(p.date)}
                                ${p.daysAway !== null ? ` · in ${p.daysAway} day${p.daysAway === 1 ? '' : 's'}` : ''}
                            </p>
                        </div>
                        <button class="v3-modal-close" data-action="close-detail" aria-label="Close">
                            ${raw(icon('x', { size: 15 }))}
                        </button>
                    </div>

                    <div class="v3-modal-body">
                        ${p.status === PROGRAM_STATUS.CANCELLED ? html`
                            <div class="v3-notice" data-tone="negative">
                                Cancelled${p.cancelReason ? ` — ${p.cancelReason}` : ''}.
                            </div>
                        ` : ''}

                        <div class="v3-facts">
                            ${fact('Venue', p.venue || '—')}
                            ${fact('Branch', d.branch?.name || '—')}
                            ${fact('Led by', d.lead?.name || 'Not assigned')}
                            ${fact('Taking part', formatNumber(d.participants.length))}
                            ${p.status === PROGRAM_STATUS.COMPLETED ? fact('Income', formatMoney(p.income || 0)) : ''}
                            ${p.status === PROGRAM_STATUS.COMPLETED ? fact('Spent', formatMoney(p.expenditure || 0)) : ''}
                            ${p.status === PROGRAM_STATUS.COMPLETED ? fact('Net', formatMoney(d.net)) : ''}
                            ${d.certificatesIssued ? fact('Certificates', formatNumber(d.certificatesIssued)) : ''}
                        </div>
                        ${p.notes ? html`<p class="v3-modal-note">${p.notes}</p>` : ''}

                        ${d.byLevel?.length ? html`
                            <h3 class="v3-card-title" style="font-size:14px;">Cast by level</h3>
                            <div class="v3-ops">
                                ${d.byLevel.map((l) => html`
                                    <span class="v3-chip">${l.label} · ${formatNumber(l.count)}</span>
                                `)}
                            </div>
                        ` : ''}

                        <h3 class="v3-card-title" style="font-size:14px;">Participants</h3>
                        ${d.participants.length ? html`
                            <div class="v3-roll">
                                ${d.participants.map((s) => html`
                                    <a class="v3-roll-row" href="#/students?student=${s.id}">
                                        <span class="v3-roll-main">
                                            <span class="v3-roll-name">${s.name}</span>
                                            <span class="v3-roll-meta">${s.admissionNo || '—'}</span>
                                        </span>
                                    </a>
                                `)}
                            </div>
                        ` : html`<p class="v3-modal-note">Nobody has been cast yet.</p>`}
                    </div>

                    <div class="v3-modal-foot">
                        <button class="v3-ghost-btn v3-btn-md" data-action="close-detail">Close</button>
                        ${canEdit && live ? html`
                            <button class="v3-ghost-btn v3-btn-md" data-action="cast">Choose cast</button>
                            <button class="v3-ghost-btn v3-btn-md" data-action="cancel-program">Cancel</button>
                            <button class="v3-ghost-btn v3-btn-md" data-action="edit">Edit</button>
                            <button class="v3-action-btn v3-btn-md" data-action="complete">Mark complete</button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `);
    }

    /* ------------------------------------------------------------ SCHEDULING */

    async programFields(existing = null) {
        const [branches, staff] = await Promise.all([
            listBranches(),
            listStaff(session.branch()).catch(() => [])
        ]);
        const defaultBranchId = existing?.branchId
            || session.branch()
            || (branches.length === 1 ? branches[0].id : '');

        return [
            { name: 'name', label: 'Name', required: true, value: existing?.name,
              placeholder: 'Annual Day 2026' },
            { name: 'type', label: 'Type', type: 'select', required: true, placeholder: 'Choose a type',
              options: programTypes().map((t) => ({ value: t.value, label: t.label })),
              value: existing?.type },
            { name: 'date', label: 'Date', type: 'date', required: true, value: existing?.date },
            { name: 'branchId', label: 'Branch', type: 'select', required: true,
              placeholder: branches.length > 1 ? 'Choose a branch' : null,
              options: branches.map((b) => ({ value: b.id, label: b.name })),
              value: defaultBranchId },
            // Required by assertShape() for examinations only — hence showIf,
            // which also keeps the validator off it for every other type.
            { name: 'level', label: 'Level examined', type: 'select', placeholder: 'Choose a level',
              options: curriculum().map((l) => ({ value: l.value, label: l.label })),
              value: existing?.level,
              showIf: (v) => v.type === 'examination',
              help: 'An examination is held for one specific level.' },
            { name: 'venue', label: 'Venue', value: existing?.venue },
            { name: 'leadStaffId', label: 'Led by', type: 'select', placeholder: 'Not assigned',
              options: staff.map((s) => ({ value: s.id, label: `${s.name} — ${s.roleLabel}` })),
              value: existing?.leadStaffId },
            { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: existing?.notes }
        ];
    }

    static seed(fields) {
        return Object.fromEntries(fields.map((f) => [f.name, f.value ?? '']));
    }

    async newProgram() {
        session.require(CAPABILITIES.PROGRAM_EDIT, 'schedule a programme');
        const fields = await this.programFields();

        const created = await formModal({
            title: 'Schedule a programme',
            description: 'A performance, workshop, competition, examination or rehearsal.',
            submitLabel: 'Schedule',
            fields,
            values: ProgramsPage.seed(fields),
            onSubmit: (v) => schedule(v)
        });

        if (!created) return;
        toast.success('Scheduled', `${created.name} on ${formatDateLong(created.date)}`);
        await this.load();
        this.open(created.id);
    }

    async editProgram() {
        const p = this.detail?.program;
        if (!p) return;
        const fields = await this.programFields(p);

        const saved = await formModal({
            title: `Edit ${p.name}`,
            fields,
            values: ProgramsPage.seed(fields),
            submitLabel: 'Save changes',
            onSubmit: (v) => updateProgram(p.id, v)
        });

        if (!saved) return;
        toast.success('Programme updated.');
        await this.open(p.id);
        await this.load();
    }

    /**
     * Casting.
     *
     * `eligibleStudents()` decides who may take part — for an examination that
     * is the students at the examined level, not the whole roll — so the list
     * is asked for rather than assembled here. `setParticipants()` replaces the
     * cast wholesale, which is why the box arrives pre-ticked with whoever is
     * already in it: submitting an empty form would clear it.
     */
    async chooseCast() {
        const p = this.detail?.program;
        if (!p) return;

        let eligible;
        try {
            eligible = await eligibleStudents(p.id);
        } catch (err) {
            toast.error(err.message);
            return;
        }
        if (!eligible.length) {
            toast.error('Nobody is eligible',
                'No student matches this programme — check its level and branch.');
            return;
        }

        const current = this.detail.participants.map((s) => s.id);

        const saved = await formModal({
            title: `Cast for ${p.name}`,
            description: `${eligible.length} student${eligible.length === 1 ? '' : 's'} eligible. `
                       + 'This replaces the current cast — anyone unticked is taken out.',
            submitLabel: 'Save cast',
            fields: [
                // eligibleStudents() returns raw student documents, so the level
                // is a code — resolve it here rather than printing "foundation-3".
                { name: 'participants', label: 'Taking part', type: 'checks', itemNoun: 'student',
                  options: eligible.map((s) => ({
                      value: s.id,
                      label: `${s.name}${s.level ? ` — ${levelLabel(s.level)}` : ''}`
                  })) }
            ],
            values: { participants: current },
            onSubmit: (v) => setParticipants(p.id, v.participants)
        });

        if (!saved) return;
        toast.success('Cast updated.');
        await this.open(p.id);
        await this.load();
    }

    /**
     * Marking a programme complete.
     *
     * This posts to the ledger — `complete()` calls `finance.postEntry()` for
     * whatever income and expenditure is entered — so the dialog says so, and
     * confirms before it goes, because there is no undo on this screen.
     */
    async completeProgram() {
        const p = this.detail?.program;
        if (!p) return;
        const cast = this.detail.participants.length;

        const done = await formModal({
            title: `Mark ${p.name} complete`,
            description: 'Income and expenditure entered here are posted to the ledger.',
            submitLabel: 'Mark complete',
            fields: [
                { name: 'attendees', label: 'How many actually came', type: 'number', min: 0,
                  help: cast ? `${cast} were cast. Leave blank to keep that figure.` : null },
                { name: 'income', label: 'Income taken', type: 'money', min: 0,
                  help: 'Ticket sales, entry fees. Posted to the ledger as income.' },
                { name: 'expenditure', label: 'Spent', type: 'money', min: 0,
                  help: 'Venue, costumes, musicians. Posted as expenditure.' },
                { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 }
            ],
            values: { attendees: '', income: '', expenditure: '', notes: '' },
            onSubmit: async (v) => {
                const income = v.income || 0;
                const spend = v.expenditure || 0;
                const ok = await confirmModal({
                    title: `Complete ${p.name}?`,
                    message: (income || spend)
                        ? `${formatMoney(income)} income and ${formatMoney(spend)} expenditure will be `
                          + 'posted to the ledger. This screen cannot undo that.'
                        : 'No money will be posted. The programme is marked complete and can then '
                          + 'have certificates issued against it.',
                    confirmLabel: 'Mark complete',
                    tone: 'caution'
                });
                if (!ok) throw new Error('Not completed. Nothing has changed.');
                return complete(p.id, {
                    attendees: v.attendees === null ? null : v.attendees,
                    income, expenditure: spend, notes: v.notes || null
                });
            }
        });

        if (!done) return;
        toast.success('Programme completed', p.name);
        this.close();
        await this.load();
    }

    async cancelProgram() {
        const p = this.detail?.program;
        if (!p) return;

        const done = await formModal({
            title: `Cancel ${p.name}`,
            description: 'It stays on record as cancelled — the cast and the date are not erased.',
            submitLabel: 'Cancel programme',
            fields: [
                { name: 'reason', label: 'Why', required: true,
                  placeholder: 'Venue unavailable, too few participants…' }
            ],
            values: { reason: '' },
            onSubmit: (v) => cancel(p.id, { reason: v.reason })
        });

        if (!done) return;
        toast.success('Programme cancelled', p.name);
        this.close();
        await this.load();
    }

    bind() {
        const root = this.container;

        this.onDispose(on(root, 'click', '[data-action="filter"]', (_e, t) => {
            const key = t.dataset.key || null;
            this.filter = this.filter === key ? null : key;
            this.paint();
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

        this.onDispose(on(root, 'click', '[data-action="new"]', () => this.newProgram()));
        this.onDispose(on(root, 'click', '[data-action="edit"]', () => this.editProgram()));
        this.onDispose(on(root, 'click', '[data-action="cast"]', () => this.chooseCast()));
        this.onDispose(on(root, 'click', '[data-action="complete"]', () => this.completeProgram()));
        this.onDispose(on(root, 'click', '[data-action="cancel-program"]', () => this.cancelProgram()));

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

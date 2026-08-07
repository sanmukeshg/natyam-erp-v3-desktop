/**
 * Natyam ERP v3 — Admin — Admissions
 *
 * The application pipeline: what has come in, what is waiting on someone, and
 * moving each application along its ladder.
 *
 * NO APPROVED v3 DESIGN EXISTS FOR THIS SCREEN. `Admissions.dc.html` was lost
 * with the design project and could not be regenerated (see
 * docs/design/README.md). Built directly on the user's instruction, from two
 * settled things rather than invention:
 *
 *   - **The workflow is the service's, not mine.** `nextActionFor()` in
 *     admissions.service.js already defines exactly one next step per status
 *     — draft→submit, submitted→review, reviewing→approve, approved→enrol,
 *     rejected→reopen. This page renders that ladder; it does not decide it.
 *     A status with no next action correctly offers none.
 *   - **The visual language is the implemented v3 system**, proven on
 *     Dashboard, Students and Attendance.
 *
 * Reconcile against `Admissions.dc.html` if it is ever recovered — the
 * business logic underneath is untouched, so that is a markup-and-CSS change.
 *
 * **New applications are not taken here yet.** Intake is a multi-step wizard
 * (ADMISSION_STEPS + validateStep + saveDraft) that deserves its own stage;
 * `js/ui/wizard.js` is deliberately not copied in. What this screen does is
 * the daily job: process what has already arrived.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on, debounce } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatDateLong } from '../../utils/date.js';
import { ADMISSION_STATUS, curriculum, CAPABILITIES } from '../../config/app.config.js';
import { formatMoney } from '../../utils/money.js';
import {
    pipeline, listApplications, applicationDetail,
    reject, reopen, enrolApplicant,
    submit as submitApplication, validateStep, ADMISSION_STEPS
} from '../../services/admissions.service.js';
import { listBranches, listFeePlans } from '../../services/settings.service.js';
import { formModal } from '../../ui/form.js';

/** Filter pills. `null` means every status. */
const FILTERS = [
    { key: null, label: 'All' },
    // Parent Portal Stage 4. Not a status — a SOURCE — so it is handled
    // separately in visibleRows() rather than passed to listApplications()'s
    // status filter. It sits second because a self-service application is the
    // one kind nobody is standing at the desk to chase.
    { key: 'source:parent', label: 'From parents' },
    { key: ADMISSION_STATUS.SUBMITTED, label: 'Submitted' },
    { key: ADMISSION_STATUS.REVIEWING, label: 'Reviewing' },
    { key: ADMISSION_STATUS.APPROVED, label: 'Approved' },
    { key: ADMISSION_STATUS.ENROLLED, label: 'Enrolled' },
    { key: ADMISSION_STATUS.REJECTED, label: 'Rejected' }
];

export default class AdmissionsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Admissions';
        this.stats = null;
        this.rows = [];
        this.filter = this.query.filter || null;
        this.search = '';
        this.detail = null;
        this.busy = false;
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head v3-page-head-row">
                <div>
                    <h1 class="v3-page-title">Admissions</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading…</p>
                </div>
                <div class="v3-head-actions">
                    <button class="v3-action-btn v3-btn-md" data-action="new">
                        ${raw(icon('plus', { size: 14 }))} New application
                    </button>
                </div>
            </div>
            <div class="v3-page-body">
                <div data-role="stats"></div>
                <section class="v3-filterbar">
                    <div class="v3-filter-row">
                        <label class="v3-search-field">
                            ${raw(icon('search', { size: 15 }))}
                            <span class="sr-only">Search applications</span>
                            <input type="search" data-role="search" placeholder="Search name, guardian, phone…">
                        </label>
                    </div>
                    <div class="v3-chips" data-role="chips"></div>
                </section>
                <section class="v3-card" data-role="list">
                    <div class="v3-skeleton">Loading applications…</div>
                </section>
            </div>
            <div data-role="modal"></div>
        `);

        this.bind();
        await this.load();

        [EVENTS.ADMISSION_SUBMITTED, EVENTS.ADMISSION_APPROVED, EVENTS.ADMISSION_ENROLLED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    async load() {
        try {
            const branchId = session.branch();
            // Branches are fetched for the review sheet's branch picker — a
            // parent-submitted application arrives with a branch NAME and no
            // id, and Reception maps it here. Loaded with the list rather
            // than on opening a sheet so the picker is never empty on first
            // paint. `listBranches` is already imported for the intake form.
            const [stats, rows, branches, feePlans] = await Promise.all([
                pipeline(branchId),
                // "From parents" is a source, not a status — passing it to the
                // service's status filter would match nothing and silently
                // empty the list. It is applied in visibleRows() instead, so
                // the query here asks for everything.
                listApplications(branchId, {
                    status: this.filter === 'source:parent' ? null : this.filter
                }),
                listBranches().catch(() => []),
                // Loaded with the list for the same reason branches are: the
                // enrol step needs them and must not be empty on first paint.
                // Failing soft — a plan list that will not load must not stop
                // someone opening an application to read it.
                listFeePlans().catch(() => [])
            ]);
            if (this.disposed) return;
            this.stats = stats;
            this.rows = rows;
            this.branches = branches;
            this.feePlans = feePlans;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Admissions failed to load', err);
            render(this.container.querySelector('[data-role="list"]'), html`
                <div class="v3-empty">Applications could not be loaded — ${err.message}</div>
            `);
        }
    }

    visibleRows() {
        // "From parents" is a source filter, not a status one, so it is
        // applied here rather than in the service query — listApplications()
        // takes a status and would have to grow a second concept to express
        // it. `preferredBranch` joins the search fields for the same reason
        // it exists: it may be the only branch a parent application carries.
        const bySource = this.filter === 'source:parent'
            ? this.rows.filter((row) => row.source === 'parent_portal')
            : this.rows;

        const term = this.search.trim().toLowerCase();
        if (!term) return bySource;
        return bySource.filter((row) =>
            [row.name, row.guardianName, row.guardianPhone, row.applicationNo, row.preferredBranch]
                .some((value) => String(value || '').toLowerCase().includes(term)));
    }

    paint() {
        const rows = this.visibleRows();
        const stats = this.stats;

        render(this.container.querySelector('[data-role="subtitle"]'),
            stats
                ? `${stats.awaitingAction} awaiting action · ${stats.total} application${stats.total === 1 ? '' : 's'}`
                : '');

        render(this.container.querySelector('[data-role="stats"]'), stats ? html`
            <div class="v3-kpis">
                ${statCard('Awaiting action', stats.awaitingAction, stats.awaitingAction ? 'caution' : 'positive')}
                ${statCard('Submitted', stats.submitted, 'neutral')}
                ${statCard('Reviewing', stats.reviewing, 'neutral')}
                ${statCard('Approved, not enrolled', stats.approved, stats.approved ? 'caution' : 'neutral')}
                ${statCard('Enrolled', stats.enrolled, 'positive')}
                ${statCard('Conversion', stats.conversionRate === null ? '—' : `${stats.conversionRate}%`, 'neutral')}
            </div>
        ` : '');

        render(this.container.querySelector('[data-role="chips"]'), html`
            ${FILTERS.map((item) => html`
                <button class="v3-pill" data-action="filter" data-key="${item.key || ''}"
                        aria-pressed="${this.filter === item.key ? 'true' : 'false'}">${item.label}</button>
            `)}
        `);

        render(this.container.querySelector('[data-role="list"]'), rows.length ? html`
            <div class="v3-roll">
                ${rows.map((row) => html`
                    <button class="v3-roll-row" data-action="open" data-id="${row.id}">
                        <span class="v3-roll-main">
                            <span class="v3-roll-name">
                                ${row.name}
                                ${row.stalled ? html`<span class="v3-chip" data-fee="overdue" style="margin-left:8px;">waiting ${row.waitingDays}d</span>` : ''}
                            </span>
                            <span class="v3-roll-meta">
                                ${row.levelLabel || '—'}${row.guardianName ? ` · ${row.guardianName}` : ''}${row.appliedOn ? ` · applied ${formatDateLong(row.appliedOn)}` : ''}
                            </span>
                        </span>
                        <span class="v3-roll-badges">
                            ${row.source === 'parent_portal' ? html`
                                <span class="v3-chip" title="Submitted by the family through the Natyam app">
                                    From parent
                                </span>
                            ` : ''}
                            <span class="v3-chip" data-admission="${row.status}">${row.statusLabel}</span>
                        </span>
                    </button>
                `)}
            </div>
        ` : html`<div class="v3-empty">No application matches these filters.</div>`);
    }

    /* --------------------------------------------------------------- DETAIL */

    async open(id) {
        try {
            this.detail = await applicationDetail(id);
            if (this.disposed) return;
            this.paintDetail();
        } catch (err) {
            toast.error(`Could not open that application — ${err.message}`);
        }
    }

    close() {
        this.detail = null;
        render(this.container.querySelector('[data-role="modal"]'), '');
    }

    paintDetail() {
        const target = this.container.querySelector('[data-role="modal"]');
        if (!this.detail) { render(target, ''); return; }

        const { application: app, levelLabel: level, statusLabel, nextAction, eligibleBatches, possibleDuplicates } = this.detail;
        const canEdit = session.can('admission.edit');
        const canApprove = session.can('admission.approve');
        // Enrolling needs a batch, so the picker below is part of the action,
        // not a separate screen. eligibleBatches comes from the service.
        const enrolling = nextAction?.key === 'enrol';

        render(target, html`
            <div class="v3-modal-scrim" data-role="scrim">
                <div class="v3-modal" role="dialog" aria-modal="true" aria-label="${app.name}">
                    <div class="v3-modal-head">
                        <div>
                            <h2 class="v3-modal-title">${app.name}</h2>
                            <p class="v3-modal-sub">
                                ${app.applicationNo || '—'} · ${level || '—'} ·
                                <span class="v3-chip" data-admission="${app.status}">${statusLabel}</span>
                            </p>
                        </div>
                        <button class="v3-modal-close" data-action="close-detail" aria-label="Close">
                            ${raw(icon('x', { size: 15 }))}
                        </button>
                    </div>

                    <div class="v3-modal-body">
                        ${possibleDuplicates?.length ? html`
                            <div class="v3-notice" data-tone="caution">
                                ${possibleDuplicates.length} similar application${possibleDuplicates.length === 1 ? '' : 's'}
                                already exist${possibleDuplicates.length === 1 ? 's' : ''} — check before enrolling.
                            </div>
                        ` : ''}

                        ${this.detail.fromParent ? html`
                            <div class="v3-notice" data-tone="info">
                                Submitted by the family through the Natyam app.
                                ${this.detail.application.applicationNo
                                    ? ''
                                    : 'A NAT/APP number is issued when you enrol.'}
                            </div>
                        ` : ''}

                        <!--
                            The review-time branch picker that used to sit here is
                            gone with Begin review. It fed beginReview()'s optional
                            branchId and offered "Decide later", which enrolment can
                            no longer honour: the service now requires a branch,
                            because a self-submitted application has only a NAME on
                            it. The question is asked in the enrol step below
                            instead, where it is required and where the answer is
                            actually used.
                        -->

                        <dl class="v3-facts">
                            ${fact('Applied on', app.appliedOn ? formatDateLong(app.appliedOn) : '—')}
                            ${fact('Level applied for', level || '—')}
                            ${fact('Guardian', app.guardianName || '—')}
                            ${fact('Phone', app.guardianPhone || '—')}
                            ${fact('Email', app.guardianEmail || '—')}
                            ${app.dateOfBirth ? fact('Date of birth', formatDateLong(app.dateOfBirth)) : ''}
                        </dl>

                        ${app.notes ? html`<div class="v3-notice" data-tone="info">${app.notes}</div>` : ''}
                        ${app.rejectionReason ? html`
                            <div class="v3-notice" data-tone="caution"><strong>Rejected:</strong> ${app.rejectionReason}</div>
                        ` : ''}

                        ${enrolling ? html`
                            <label class="v3-select-label" style="flex-direction:column;align-items:stretch;gap:6px;">
                                <span>Enrol into which batch? *</span>
                                <select class="v3-branch-select" data-role="batch" style="max-width:none;">
                                    <option value="">Choose a batch…</option>
                                    ${(eligibleBatches || []).map((batch) => html`
                                        <option value="${batch.id}">
                                            ${batch.name}${batch.seatsLeft != null ? ` — ${batch.seatsLeft} seat${batch.seatsLeft === 1 ? '' : 's'} left` : ''}
                                        </option>
                                    `)}
                                </select>
                            </label>
                            ${eligibleBatches?.length ? '' : html`
                                <div class="v3-notice" data-tone="caution">
                                    No batch matches this level yet. Create or open one before enrolling.
                                </div>
                            `}

                            <label class="v3-select-label" style="flex-direction:column;align-items:stretch;gap:6px;">
                                <span>On which fee plan? *</span>
                                <select class="v3-branch-select" data-role="fee-plan" style="max-width:none;">
                                    <option value="">Choose a fee plan…</option>
                                    ${(this.feePlans || []).map((plan) => html`
                                        <option value="${plan.id}"
                                                ${plan.id === app.feePlanId ? 'selected' : ''}>
                                            ${plan.name} — ${formatMoney(plan.amount)}
                                        </option>
                                    `)}
                                </select>
                            </label>
                            ${this.feePlans?.length ? '' : html`
                                <div class="v3-notice" data-tone="caution">
                                    No fee plans are set up yet — add one in Settings before enrolling.
                                </div>
                            `}

                            ${!app.branchId ? html`
                                <label class="v3-select-label" style="flex-direction:column;align-items:stretch;gap:6px;">
                                    <span>Which branch? *</span>
                                    <select class="v3-branch-select" data-role="enrol-branch" style="max-width:none;">
                                        <option value="">Choose a branch…</option>
                                        ${(this.branches || []).map((b) => html`
                                            <option value="${b.id}"
                                                    ${b.id === this.suggestedBranchId(app) ? 'selected' : ''}>
                                                ${b.name}
                                            </option>
                                        `)}
                                    </select>
                                </label>
                                ${app.preferredBranch ? html`
                                    <div class="v3-notice" data-tone="info">
                                        The family asked for ${app.preferredBranch}. Confirm the branch
                                        this application belongs to.
                                    </div>
                                ` : ''}
                            ` : ''}
                        ` : ''}
                    </div>

                    <div class="v3-modal-foot">
                        <button class="v3-ghost-btn v3-btn-md" data-action="close-detail">Close</button>

                        ${app.status === ADMISSION_STATUS.REVIEWING || app.status === ADMISSION_STATUS.SUBMITTED ? html`
                            <button class="v3-ghost-btn v3-btn-md" data-action="reject"
                                    ${canApprove && !this.busy ? '' : 'disabled'}>Reject</button>
                        ` : ''}

                        ${nextAction ? html`
                            <button class="v3-action-btn v3-btn-md" data-action="advance" data-key="${nextAction.key}"
                                    ${this.canDo(nextAction.key, canEdit, canApprove) && !this.busy ? '' : 'disabled'}>
                                ${this.busy ? 'Working…' : nextAction.label}
                            </button>
                        ` : html`<span class="v3-modal-note">No further action — this application is closed.</span>`}
                    </div>
                </div>
            </div>
        `);
    }

    /** Mirrors the service's own session.require() calls, so the UI never offers what the service will refuse. */
    canDo(key, canEdit, canApprove) {
        if (key === 'review') return canEdit;
        if (key === 'submit') return canEdit;
        return canApprove;   // approve, enrol, reopen
    }

    /* -------------------------------------------------------------- ACTIONS */

    async advance(key) {
        const app = this.detail?.application;
        if (!app || this.busy) return;

        if (key === 'enrol') return this.enrol(app);

        this.busy = true;
        this.paintDetail();
        try {
            // 'review' and 'approve' are no longer reachable: nextActionFor()
            // sends submitted, reviewing and approved all straight to Enrol.
            // The NAT/APP number and the ERP branch that Begin review used to
            // allocate are issued at enrolment now — see enrolApplicant().
            if (key === 'reopen') await reopen(app.id);
            else throw new Error(`"${key}" is not something this screen can do yet.`);

            toast.success('Application updated', app.name);
            this.busy = false;
            this.close();
            await this.load();
        } catch (err) {
            this.busy = false;
            if (this.disposed) return;
            toast.error(err.message);
            this.paintDetail();
        }
    }

    /**
     * The branch the family named, matched to a real Branch record.
     *
     * Only a default for the picker — the person still confirms. Matched
     * leniently because the two lists genuinely disagree: the name reached the
     * parent through hand-written Website Content ("Natyam - Kondapur", hyphen)
     * while the Branch record is "Natyam – Kondapur" with an en dash, so a
     * literal comparison would offer no default at all.
     *
     * Three fallbacks behind that, added with UAT5-BUG-506 and identical in
     * natyam-mobile so the two pickers cannot start on different branches for
     * the same application:
     *   1. the service's own suggestBranchFor(), already on the detail — it
     *      matches by containment, which catches an ERP record simply called
     *      "Kondapur" where the parent wrote the full name;
     *   2. the only branch, when the school has one;
     *   3. the branch already being worked in.
     */
    suggestedBranchId(app) {
        if (this.detail?.suggestedBranch?.id) return this.detail.suggestedBranch.id;

        const branches = this.branches || [];
        if (branches.length === 1) return branches[0].id;

        const flatten = (s) => String(s || '').toLowerCase().replace(/[‐-―-]/g, '-').replace(/\s+/g, ' ').trim();
        const asked = flatten(app.preferredBranch);
        const matched = asked ? branches.find((b) => flatten(b.name) === asked)?.id : null;

        return matched || session.branch() || '';
    }

    async enrol(app) {
        const select = this.container.querySelector('[data-role="batch"]');
        const batchId = select?.value;
        if (!batchId) {
            toast.error('Choose a batch', 'An applicant is enrolled into a batch, so one has to be picked first.');
            return;
        }

        /*
         * Fee plan and branch, both required — matching natyam-mobile exactly.
         *
         * Without a plan enrolApplicant() skips billing silently: no schedule,
         * no invoice, and a student showing zero fees forever. Without a branch
         * a self-submitted application cannot be enrolled at all, since the
         * service now requires one and a parent never supplies an id.
         *
         * Checked here rather than trusted to the markup — these are bare
         * selects in a sheet, not a form, so nothing enforces them on submit.
         */
        const feePlanId = this.container.querySelector('[data-role="fee-plan"]')?.value;
        if (!feePlanId) {
            toast.error('Choose a fee plan',
                'Without one the student is enrolled but never billed — no schedule, no invoice.');
            return;
        }

        let branchId = null;
        if (!app.branchId) {
            branchId = this.container.querySelector('[data-role="enrol-branch"]')?.value || null;
            if (!branchId) {
                toast.error('Choose a branch',
                    'This application arrived from the Natyam app with only a branch name on it.');
                return;
            }
        }

        this.busy = true;
        this.paintDetail();
        try {
            await enrolApplicant(app.id, { batchId, feePlanId, branchId });
            toast.success('Enrolled', `${app.name} is now a student.`);
            this.busy = false;
            this.close();
            await this.load();
        } catch (err) {
            this.busy = false;
            if (this.disposed) return;
            toast.error(`Could not enrol — ${err.message}`);
            this.paintDetail();
        }
    }

    async doReject() {
        const app = this.detail?.application;
        if (!app || this.busy) return;

        // The service requires a reason, so it is asked for rather than sent
        // empty and left to throw. A native prompt is deliberate: a bespoke
        // dialog for one field is not worth the surface area, and this flow
        // is rare.
        const reason = window.prompt(`Why is ${app.name}'s application being rejected?`);
        if (reason === null) return;                       // cancelled
        if (!reason.trim()) { toast.error('A reason is required to reject an application.'); return; }

        this.busy = true;
        this.paintDetail();
        try {
            await reject(app.id, { reason: reason.trim() });
            toast.success('Application rejected', app.name);
            this.busy = false;
            this.close();
            await this.load();
        } catch (err) {
            this.busy = false;
            if (this.disposed) return;
            toast.error(err.message);
            this.paintDetail();
        }
    }

    /* --------------------------------------------------------------- EVENTS */

    bind() {
        const root = this.container;

        this.onDispose(on(root, 'click', '[data-action="filter"]', (_e, target) => {
            const key = target.dataset.key || null;
            this.filter = this.filter === key ? null : key;
            this.load();
        }));

        this.onDispose(on(root, 'input', '[data-role="search"]', debounce((_e, target) => {
            this.search = target.value;
            this.paint();
            const field = root.querySelector('[data-role="search"]');
            if (field && document.activeElement !== field) {
                field.focus();
                field.setSelectionRange(field.value.length, field.value.length);
            }
        }, 180)));

        this.onDispose(on(root, 'click', '[data-action="open"]', (_e, target) => this.open(target.dataset.id)));
        this.onDispose(on(root, 'click', '[data-action="close-detail"]', () => this.close()));
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
            this.close();
        }));
        this.onDispose(on(root, 'click', '[data-action="advance"]', (_e, target) => this.advance(target.dataset.key)));
        this.onDispose(on(root, 'click', '[data-action="reject"]', () => this.doReject()));

        this.onDispose(on(root, 'click', '[data-action="new"]', () => this.newApplication()));

        this.onKey = (event) => { if (event.key === 'Escape' && this.detail) this.close(); };
        window.addEventListener('keydown', this.onKey);
        this.onDispose(() => window.removeEventListener('keydown', this.onKey));
    }

    /* ------------------------------------------------------------------ INTAKE */

    /**
     * Taking a new application.
     *
     * ONE GROUPED FORM, NOT A WIZARD, and that is a deliberate change from the
     * reference. `ADMISSION_STEPS` is a *validation* structure, and it stays
     * exactly that — every step still gets checked, by the service's own
     * `validateStep()`, through the form's `validateAll` hook below. What the
     * reference additionally made it was a *navigation* structure: five screens
     * to click through for a walk-in standing at the desk, where the whole
     * application is fourteen fields. On a desktop screen those fourteen fit
     * at once under the step names as headings, so the person taking the
     * application can see and correct the whole thing rather than discovering
     * on screen four that they mistyped something on screen one.
     *
     * The steps survive as dividers, in their own order, so the shape is still
     * recognisable to anyone who knows the paper form.
     *
     * NOT CARRIED OVER: drafts. `saveDraft`/`loadDraft`/`listDrafts`/
     * `discardDraft` exist in the service and are not surfaced here. A draft
     * only earns its keep when a form is long enough to abandon halfway, which
     * is precisely what collapsing the wizard removes. `submit()` still accepts
     * a `draftId`, so nothing is closed off if drafts come back.
     */
    async newApplication() {
        session.require(CAPABILITIES.ADMISSION_EDIT, 'take an application');

        const [branches, plans] = await Promise.all([listBranches(), listFeePlans()]);
        const defaultBranchId = session.branch() || (branches.length === 1 ? branches[0].id : '');

        const fields = [
            { type: 'divider', label: 'Applicant' },
            { name: 'name', label: 'Applicant name', required: true },
            { name: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true },
            { name: 'gender', label: 'Gender', type: 'select', required: true, placeholder: 'Choose',
              options: [
                  { value: 'female', label: 'Female' },
                  { value: 'male', label: 'Male' },
                  { value: 'other', label: 'Other' }
              ] },
            { name: 'guardianName', label: 'Parent or guardian', required: true },
            { name: 'guardianRelation', label: 'Relationship', type: 'select', required: true,
              options: ['Mother', 'Father', 'Grandparent', 'Guardian', 'Sibling']
                  .map((r) => ({ value: r, label: r })) },
            { name: 'guardianPhone', label: 'Contact number', type: 'tel', required: true },
            { name: 'guardianEmail', label: 'Email', type: 'email' },
            { name: 'address', label: 'Address', type: 'textarea', rows: 2 },

            { type: 'divider', label: 'Placement' },
            { name: 'branchId', label: 'Branch', type: 'select', required: true,
              placeholder: branches.length > 1 ? 'Choose a branch' : null,
              options: branches.map((b) => ({ value: b.id, label: b.name })) },
            { name: 'level', label: 'Starting level', type: 'select', required: true, placeholder: 'Choose a level',
              options: curriculum().map((l) => ({ value: l.value, label: l.label })) },

            { type: 'divider', label: 'Experience' },
            { name: 'priorExperience', label: 'Previous training', type: 'select',
              options: [
                  { value: 'none', label: 'None — complete beginner' },
                  { value: 'kuchipudi', label: 'Kuchipudi elsewhere' },
                  { value: 'bharatanatyam', label: 'Bharatanatyam' },
                  { value: 'other-classical', label: 'Another classical form' },
                  { value: 'other', label: 'Other dance' }
              ] },
            { name: 'yearsOfPractice', label: 'Years of practice', type: 'number', min: 0, max: 40 },

            { type: 'divider', label: 'Fee plan' },
            { name: 'feePlanId', label: 'Fee plan', type: 'select', required: true, placeholder: 'Choose a plan',
              options: plans.map((p) => ({ value: p.id, label: `${p.name} — ${formatMoney(p.amount)}` })) },
            { name: 'feeNotes', label: 'Concession or note', type: 'textarea', rows: 2 }
        ];

        const created = await formModal({
            title: 'New application',
            description: 'Taken at the desk. It enters the pipeline as submitted.',
            submitLabel: 'Submit application',
            fields,
            values: {
                ...Object.fromEntries(fields.filter((f) => f.type !== 'divider').map((f) => [f.name, ''])),
                branchId: defaultBranchId,
                guardianRelation: 'Mother',
                priorExperience: 'none'
            },
            /*
             * Delegated to the service's own step rules rather than restated
             * here. `validateStep()` already knows that the school takes
             * students from age 4, that a contact number needs ten digits and
             * that a date of birth cannot be in the future — and it returns a
             * field-keyed map, which is exactly the shape this hook wants.
             * Restating any of that would be a second copy to keep in step.
             */
            validateAll: (values) => {
                const all = {};
                for (const step of ADMISSION_STEPS) {
                    Object.assign(all, validateStep(step.key, values).errors);
                }
                return all;
            },
            onSubmit: (values) => submitApplication(values)
        });

        if (!created) return;
        toast.success('Application taken', `${created.name} — ${created.applicationNo}`);
        await this.load();
        this.open(created.id);
    }
}

/* ------------------------------------------------------------------ HELPERS */

function statCard(label, value, tone) {
    return html`
        <div class="v3-kpi" data-tone="${tone}">
            <div style="flex:1;min-width:0;">
                <div class="v3-kpi-label">${label}</div>
                <div class="v3-kpi-value">${value}</div>
            </div>
        </div>
    `;
}

function fact(label, value) {
    return html`<div class="v3-fact"><dt>${label}</dt><dd>${value}</dd></div>`;
}

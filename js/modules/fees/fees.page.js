/**
 * Natyam ERP v3 — Admin — Fee collection
 *
 * NO APPROVED v3 DESIGN EXISTS FOR THIS SCREEN — Fees was never part of the
 * Claude Design project at all (see docs/design/README.md), so unlike
 * Attendance and Admissions there is not even a lost file to reconcile
 * against later. Built from the v3 system already proven across five screens.
 *
 * **The model is student-centric, not invoice-centric**, and that is carried
 * over from the reference app deliberately: a school collects money from a
 * person standing at a desk, not from an invoice number. So the list is
 * students who owe, and opening one shows their invoices, their receipts, and
 * the form to take money against a specific invoice.
 *
 * Computes nothing: `listStudents()` already returns `outstanding`, `overdue`
 * and `feeState` per student; `collectionSummary()` gives the month; and
 * `studentFeeSummary()` gives one student's ledger. All from services carried
 * over unmodified — except `collectionSummary()`, which v3 fixes; see
 * MIGRATION_CHECKLIST.md's "Intentional divergences".
 *
 * The payment form mirrors the service's validation where it is cheap (a max
 * on the amount, the mode list, a conditional reference field) but **never
 * replaces it** — `recordPayment()` re-validates everything and is the
 * authority. The UI's job is to make the common case fast, not to be the
 * rulebook.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on, debounce, formData } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatMoney, formatMoneyShort } from '../../utils/money.js';
import { formatDate, formatDateLong, localDate, startOfMonth } from '../../utils/date.js';
import { PAYMENT_MODES } from '../../config/app.config.js';
import { listStudents } from '../../services/students.service.js';
import { collectionSummary, studentFeeSummary, recordPayment, waiveInvoice } from '../../services/fees.service.js';
import { formModal } from '../../ui/form.js';

const FILTERS = [
    { key: null, label: 'Everyone' },
    { key: 'due', label: 'Has dues' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'clear', label: 'Paid up' }
];

export default class FeesPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Fee collection';
        this.rows = [];
        this.summary = null;
        // The Dashboard links here as ?filter=overdue ("Chase payments") and
        // ?filter=outstanding from the Outstanding KPI. Both mean "show me
        // who owes", so `outstanding` is accepted as an alias for `due`.
        const incoming = this.query.filter || null;
        this.filter = incoming === 'outstanding' ? 'due' : incoming;
        this.search = '';
        this.detail = null;          // { student, fees }
        this.payingInvoiceId = null; // which invoice the open form is against
        this.busy = false;
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head v3-page-head-row">
                <div>
                    <h1 class="v3-page-title">Fee collection</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading…</p>
                </div>
            </div>
            <div class="v3-page-body">
                <div data-role="summary"></div>
                <section class="v3-filterbar">
                    <div class="v3-filter-row">
                        <label class="v3-search-field">
                            ${raw(icon('search', { size: 15 }))}
                            <span class="sr-only">Search students</span>
                            <input type="search" data-role="search" placeholder="Search name, admission no, guardian, phone…">
                        </label>
                    </div>
                    <div class="v3-chips" data-role="chips"></div>
                </section>
                <section class="v3-card" data-role="list">
                    <div class="v3-skeleton">Loading the roll…</div>
                </section>
            </div>
            <div data-role="modal"></div>
        `);

        this.bind();
        await this.load();

        [EVENTS.PAYMENT_RECORDED, EVENTS.PAYMENT_REFUNDED, EVENTS.INVOICE_CREATED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    /**
     * ENH-309 — writing off an invoice.
     *
     * A waiver forgives money already owed, which is why the reason is
     * mandatory in waiveInvoice() itself rather than only in this form: it is
     * the answer to a question somebody will ask months later, and it belongs
     * on the record whichever screen the waiver came from.
     *
     * The whole outstanding balance goes. There is no partial waiver by
     * decision — a part-forgiven invoice that stays open is a harder thing to
     * explain on a statement than two clean states.
     *
     * No separate confirm step: the dialog names the invoice and the amount in
     * its own title and intro, the submit button says "Waive", and the action
     * is reversible in the sense that matters — the invoice stays on record
     * with the reason attached rather than disappearing.
     */
    async waive(invoiceId) {
        const invoice = (this.detail?.fees?.invoices || []).find((i) => i.id === invoiceId);
        if (!invoice) return;

        const done = await formModal({
            title: `Waive ${invoice.number}?`,
            description: `${formatMoney(invoice.balance)} is outstanding. Waiving writes that balance `
                + 'off — the invoice stays on record with the reason attached.',
            submitLabel: 'Waive invoice',
            fields: [
                { name: 'reason', label: 'Reason', type: 'textarea', rows: 3, required: true,
                  help: 'Scholarship, hardship, goodwill — whatever it is, someone will ask later.' }
            ],
            values: { reason: '' },
            onSubmit: (v) => waiveInvoice(invoice.id, { reason: v.reason })
        });

        if (!done) return;
        toast.success('Invoice waived', invoice.number);
        await this.load();
    }

    async load() {
        try {
            const branchId = session.branch();
            const [rows, summary] = await Promise.all([
                listStudents(branchId, { status: 'all' }),
                collectionSummary({ from: startOfMonth(), to: localDate(), branchId })
            ]);
            if (this.disposed) return;
            this.rows = rows;
            this.summary = summary;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Fees failed to load', err);
            render(this.container.querySelector('[data-role="list"]'), html`
                <div class="v3-empty">Fees could not be loaded — ${err.message}</div>
            `);
        }
    }

    visibleRows() {
        const term = this.search.trim().toLowerCase();
        let rows = this.rows;

        if (this.filter === 'due') rows = rows.filter((r) => r.outstanding > 0);
        else if (this.filter === 'overdue') rows = rows.filter((r) => r.overdue > 0);
        else if (this.filter === 'clear') rows = rows.filter((r) => !r.outstanding);

        if (term) {
            rows = rows.filter((r) =>
                [r.name, r.admissionNo, r.guardianName, r.guardianPhone]
                    .some((v) => String(v || '').toLowerCase().includes(term)));
        }
        // Whoever owes the most, and longest, first — this is a worklist.
        return [...rows].sort((a, b) => (b.overdue - a.overdue) || (b.outstanding - a.outstanding));
    }

    paint() {
        const rows = this.visibleRows();
        const s = this.summary;

        render(this.container.querySelector('[data-role="subtitle"]'),
            s ? `${formatMoney(s.collected)} collected this month · ${formatMoney(s.outstanding)} outstanding` : '');

        render(this.container.querySelector('[data-role="summary"]'), s ? html`
            <div class="v3-kpis">
                ${kpi('Collected this month', formatMoney(s.collected), 'positive', `${s.receiptCount} receipt${s.receiptCount === 1 ? '' : 's'}`)}
                ${kpi('Outstanding', formatMoney(s.outstanding), s.outstanding ? 'caution' : 'positive', `${s.outstandingCount} invoice${s.outstandingCount === 1 ? '' : 's'}`)}
                ${kpi('Overdue', formatMoney(s.overdue), s.overdueCount ? 'negative' : 'positive', `${s.overdueCount} invoice${s.overdueCount === 1 ? '' : 's'}`)}
            </div>
            ${s.ageing?.some((b) => b.count) ? html`
                <section class="v3-card">
                    <div class="v3-card-head"><h2 class="v3-card-title">How old the dues are</h2></div>
                    <div class="v3-card-body v3-ageing">
                        ${s.ageing.map((bucket) => html`
                            <div class="v3-ageing-cell">
                                <div class="v3-metric-label">${bucket.label}</div>
                                <div class="v3-metric-value">${formatMoneyShort(bucket.amount)}</div>
                                <div class="v3-row-detail">${bucket.count} invoice${bucket.count === 1 ? '' : 's'}</div>
                            </div>
                        `)}
                    </div>
                </section>
            ` : ''}
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
                            <span class="v3-roll-name">${row.name}</span>
                            <span class="v3-roll-meta">
                                ${row.batchName || 'Not in a batch'}${row.guardianName ? ` · ${row.guardianName}` : ''}
                            </span>
                        </span>
                        <span class="v3-roll-badges">
                            ${row.outstanding > 0 ? html`
                                <span class="v3-chip" data-fee="${row.overdue > 0 ? 'overdue' : 'due'}">
                                    ${formatMoney(row.overdue > 0 ? row.overdue : row.outstanding)}
                                    ${row.overdue > 0 ? 'overdue' : 'due'}
                                </span>
                            ` : html`<span class="v3-chip" data-fee="clear">Paid up</span>`}
                        </span>
                    </button>
                `)}
            </div>
        ` : html`<div class="v3-empty">Nobody matches these filters.</div>`);
    }

    /* --------------------------------------------------------------- DETAIL */

    async open(studentId) {
        try {
            const student = this.rows.find((r) => r.id === studentId);
            const fees = await studentFeeSummary(studentId);
            if (this.disposed) return;
            this.detail = { student, fees };
            this.payingInvoiceId = null;
            this.paintDetail();
        } catch (err) {
            toast.error(`Could not open that student's fees — ${err.message}`);
        }
    }

    close() {
        this.detail = null;
        this.payingInvoiceId = null;
        render(this.container.querySelector('[data-role="modal"]'), '');
    }

    paintDetail() {
        const target = this.container.querySelector('[data-role="modal"]');
        if (!this.detail) { render(target, ''); return; }

        const { student, fees } = this.detail;
        const canCollect = session.can('fee.collect');
        const open = (fees.invoices || [])
            .filter((i) => i.status !== 'cancelled' && i.balance > 0)
            .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
        const settled = (fees.invoices || []).filter((i) => i.balance <= 0 || i.status === 'cancelled');

        render(target, html`
            <div class="v3-modal-scrim" data-role="scrim">
                <div class="v3-modal" role="dialog" aria-modal="true" aria-label="${student?.name || 'Fees'}">
                    <div class="v3-modal-head">
                        <div>
                            <h2 class="v3-modal-title">${student?.name || 'Student'}</h2>
                            <p class="v3-modal-sub">
                                ${student?.admissionNo || '—'}${student?.batchName ? ` · ${student.batchName}` : ''}${fees.billingCycle ? ` · billed ${fees.billingCycle.frequency.toLowerCase()}` : ''}
                            </p>
                        </div>
                        <button class="v3-modal-close" data-action="close-detail" aria-label="Close">
                            ${raw(icon('x', { size: 15 }))}
                        </button>
                    </div>

                    <div class="v3-modal-body">
                        <div class="v3-metrics">
                            ${metric('Billed', formatMoney(fees.billed))}
                            ${metric('Collected', formatMoney(fees.collected))}
                            ${metric('Outstanding', formatMoney(fees.outstanding))}
                        </div>

                        ${fees.overdue > 0 ? html`
                            <div class="v3-notice" data-tone="caution">
                                ${formatMoney(fees.overdue)} is past its due date${fees.oldestDue ? `, the oldest since ${formatDateLong(fees.oldestDue)}` : ''}.
                            </div>
                        ` : fees.onTrack ? html`
                            <div class="v3-notice" data-tone="info">Nothing outstanding — this student is paid up.</div>
                        ` : ''}

                        ${open.length ? html`
                            <h3 class="v3-card-title" style="font-size:var(--text-sm);">Open invoices</h3>
                            ${open.map((invoice) => this.invoiceRow(invoice, canCollect))}
                        ` : ''}

                        ${fees.receipts?.length ? html`
                            <h3 class="v3-card-title" style="font-size:var(--text-sm);margin-top:6px;">Recent receipts</h3>
                            <dl class="v3-facts">
                                ${fees.receipts.slice(0, 6).map((r) => html`
                                    <div class="v3-fact">
                                        <dt>${r.receiptNo || 'Receipt'} · ${formatDate(r.paidOn)}${r.mode ? ` · ${r.mode}` : ''}</dt>
                                        <dd>${formatMoney(r.amount)}</dd>
                                    </div>
                                `)}
                            </dl>
                        ` : ''}

                        ${!open.length && !fees.receipts?.length ? html`
                            <p class="v3-modal-note">No invoices have been raised for this student yet.</p>
                        ` : ''}
                    </div>

                    <div class="v3-modal-foot">
                        <button class="v3-ghost-btn v3-btn-md" data-action="close-detail">Close</button>
                    </div>
                </div>
            </div>
        `);
    }

    /** One open invoice, with its collect form expanded inline when chosen. */
    invoiceRow(invoice, canCollect) {
        const overdue = invoice.balance > 0 && invoice.dueDate < localDate();
        const paying = this.payingInvoiceId === invoice.id;

        return html`
            <div class="v3-invoice" data-overdue="${overdue ? 'true' : 'false'}">
                <div class="v3-invoice-head">
                    <div class="v3-row-main">
                        <div class="v3-row-title">${invoice.number || invoice.description || 'Invoice'}</div>
                        <div class="v3-row-detail">
                            Due ${invoice.dueDate ? formatDateLong(invoice.dueDate) : '—'}
                            ${invoice.paidAmount ? ` · ${formatMoney(invoice.paidAmount)} paid so far` : ''}
                        </div>
                    </div>
                    <div class="v3-invoice-amount">
                        <span class="v3-chip" data-fee="${overdue ? 'overdue' : 'due'}">${formatMoney(invoice.balance)}</span>
                        ${canCollect ? html`
                            <button class="v3-action-btn v3-btn-sm" data-action="collect" data-id="${invoice.id}">
                                ${paying ? 'Cancel' : 'Collect'}
                            </button>
                        ` : ''}
                        <!--
                          ENH-309. Gated on fee.waive, NOT fee.collect — those
                          are different capabilities and only Administrator and
                          Owner hold the former. The v2 screen gated this on
                          fee.collect, which showed Reception a button that
                          waiveInvoice() then refused.
                        -->
                        ${session.can('fee.waive') && invoice.balance > 0 ? html`
                            <button class="v3-action-btn v3-btn-sm" data-action="waive" data-id="${invoice.id}">
                                Waive
                            </button>
                        ` : ''}
                    </div>
                </div>

                ${paying ? html`
                    <form class="v3-pay" data-role="pay-form" data-id="${invoice.id}">
                        <div class="v3-pay-grid">
                            <label class="v3-field">
                                <span>Amount</span>
                                <input class="v3-input" type="number" name="amount" required
                                       min="1" max="${invoice.balance}" step="1" value="${invoice.balance}"
                                       inputmode="numeric">
                            </label>
                            <label class="v3-field">
                                <span>How was it paid?</span>
                                <select class="v3-input" name="mode" data-role="mode" required>
                                    ${PAYMENT_MODES.map((m) => html`<option value="${m.value}">${m.label}</option>`)}
                                </select>
                            </label>
                            <label class="v3-field" data-role="reference-field">
                                <span>Reference</span>
                                <input class="v3-input" type="text" name="reference"
                                       placeholder="UPI / txn / cheque no">
                            </label>
                            <label class="v3-field">
                                <span>Received on</span>
                                <input class="v3-input" type="date" name="paidOn"
                                       value="${localDate()}" max="${localDate()}">
                            </label>
                        </div>
                        <div class="v3-pay-foot">
                            <span class="v3-row-detail">
                                Balance after this: <strong data-role="after">${formatMoney(0)}</strong>
                            </span>
                            <button class="v3-action-btn v3-btn-md" type="submit" ${this.busy ? 'disabled' : ''}>
                                ${this.busy ? 'Recording…' : 'Record payment'}
                            </button>
                        </div>
                    </form>
                ` : ''}
            </div>
        `;
    }

    /**
     * The reference field is only required for modes that reconcile against a
     * bank statement — the service enforces it, this just stops the person
     * discovering that after they press the button.
     */
    syncReferenceField() {
        const form = this.container.querySelector('[data-role="pay-form"]');
        if (!form) return;
        const mode = PAYMENT_MODES.find((m) => m.value === form.querySelector('[data-role="mode"]').value);
        const field = form.querySelector('[data-role="reference-field"]');
        const input = field.querySelector('input');
        field.hidden = !mode?.needsReference;
        input.required = Boolean(mode?.needsReference);
    }

    syncRemaining() {
        const form = this.container.querySelector('[data-role="pay-form"]');
        if (!form) return;
        const invoice = this.detail?.fees.invoices.find((i) => i.id === form.dataset.id);
        if (!invoice) return;
        const entered = Number(form.querySelector('[name="amount"]').value) || 0;
        render(form.querySelector('[data-role="after"]'), formatMoney(Math.max(0, invoice.balance - entered)));
    }

    async submitPayment(form) {
        if (this.busy) return;
        const invoiceId = form.dataset.id;
        const { amount, mode, reference, paidOn } = formData(form);

        this.busy = true;
        this.paintDetail();

        try {
            await recordPayment({
                invoiceId,
                amount: Number(amount),
                mode,
                reference: reference || null,
                paidOn: paidOn || null
            });
            toast.success('Payment recorded', `${formatMoney(Number(amount))} received.`);
            this.busy = false;
            this.payingInvoiceId = null;
            // Reload the student's ledger and the list behind it — a payment
            // changes both, and a stale balance here is exactly the sort of
            // thing someone would collect against twice.
            const studentId = this.detail?.student?.id;
            await this.load();
            if (studentId && !this.disposed) await this.open(studentId);
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

        this.onDispose(on(root, 'click', '[data-action="waive"]', (_e, t) => this.waive(t.dataset.id)));

        this.onDispose(on(root, 'click', '[data-action="collect"]', (_e, t) => {
            this.payingInvoiceId = this.payingInvoiceId === t.dataset.id ? null : t.dataset.id;
            this.paintDetail();
            this.syncReferenceField();
            this.syncRemaining();
            this.container.querySelector('[name="amount"]')?.focus();
        }));

        this.onDispose(on(root, 'change', '[data-role="mode"]', () => this.syncReferenceField()));
        this.onDispose(on(root, 'input', '[name="amount"]', () => this.syncRemaining()));

        this.onDispose(on(root, 'submit', '[data-role="pay-form"]', (event, form) => {
            event.preventDefault();
            this.submitPayment(form);
        }));

        this.onKey = (event) => { if (event.key === 'Escape' && this.detail) this.close(); };
        window.addEventListener('keydown', this.onKey);
        this.onDispose(() => window.removeEventListener('keydown', this.onKey));
    }
}

/* ------------------------------------------------------------------ HELPERS */

function kpi(label, value, tone, note) {
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

function metric(label, value) {
    return html`<div class="v3-metric"><div class="v3-metric-label">${label}</div><div class="v3-metric-value">${value}</div></div>`;
}

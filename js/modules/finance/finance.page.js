/**
 * Natyam ERP v3 — Admin — Finance
 *
 * The books. Four distinct jobs, so four tabs rather than one screen trying to
 * be all of them: what the month looks like, where the money went, the ledger
 * itself, and payroll.
 *
 * EVERY AMOUNT IS INTEGER PAISE. There is no floating point in
 * finance.service.js, which is why the P&L adds up — so nothing here divides,
 * multiplies or rounds a money value. `formatMoney()` is the only thing that
 * turns paise into something to read.
 *
 * THE LEDGER IS APPEND-ONLY, and that shapes this screen more than anything
 * else. `reverseEntry()` writes a *contra* entry; it does not edit or delete
 * the original. So there is no edit button on a ledger row, and the reversal
 * dialog says a correcting entry will appear rather than implying the mistake
 * disappears. An accounting screen that lets you quietly change history is
 * worse than no accounting screen.
 *
 * `recordExpense()` and `paySalaries()` write to their own store *and* the
 * ledger together, inside one transaction — so this page never posts an
 * expense and a ledger line separately, and never offers to.
 *
 * NO DESIGN FILE. Reuses the tabbed shape Settings established, with the KPI
 * strip and card list from the other Phase-2 screens.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatMoney, formatNumber } from '../../utils/money.js';
import { localDate, monthKey, formatDateLong } from '../../utils/date.js';
import { CAPABILITIES, expenseCategories } from '../../config/app.config.js';
import {
    ACCOUNTS, currentMonthPosition, profitAndLoss, monthlySeries,
    ledgerView, expenseBreakdown, listExpenses, preparePayroll,
    postEntry, reverseEntry, recordExpense, updateExpense, removeExpense, paySalaries
} from '../../services/finance.service.js';
import { listBranches } from '../../services/settings.service.js';
import { formModal, confirmModal } from '../../ui/form.js';

const TABS = [
    { key: 'position', label: 'This month' },
    { key: 'expenses', label: 'Spending' },
    { key: 'ledger', label: 'Ledger' },
    { key: 'payroll', label: 'Payroll' }
];

export default class FinancePage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Finance';
        this.tab = this.query.tab || 'position';
        this.period = this.query.period || monthKey();
        this.data = {};
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head v3-page-head-row">
                <div>
                    <h1 class="v3-page-title">Finance</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading…</p>
                </div>
                <div class="v3-head-actions">
                    <input class="v3-branch-select" type="month" data-role="period" value="${this.period}"
                           max="${monthKey()}" aria-label="Month">
                    ${session.can(CAPABILITIES.FINANCE_EDIT) ? html`
                        <button class="v3-ghost-btn v3-btn-md" data-action="add-expense">Record spending</button>
                        <button class="v3-action-btn v3-btn-md" data-action="post-entry">Post entry</button>
                    ` : ''}
                </div>
            </div>
            <div class="v3-page-body">
                <div class="v3-tabs v3-tabs-page" role="tablist">
                    ${TABS.map((t) => html`
                        <button class="v3-tab" data-action="tab" data-tab="${t.key}" role="tab"
                                aria-selected="${this.tab === t.key ? 'true' : 'false'}">${t.label}</button>
                    `)}
                </div>
                <div data-role="panel"><div class="v3-skeleton">Loading…</div></div>
            </div>
        `);

        this.bind();
        await this.load();

        // SALARY_PROCESSED, not SALARY_PAID — the latter does not exist, and
        // listening for it would silently never fire.
        [EVENTS.EXPENSE_RECORDED, EVENTS.LEDGER_POSTED, EVENTS.SALARY_PROCESSED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    /** The month being looked at, as the `{from,to}` every service here wants. */
    range() {
        const from = `${this.period}-01`;
        // The current month stops at today; a past month runs to its end. Asking
        // for a range that extends into the future would be harmless but would
        // print a "to" date that has not happened.
        const isThisMonth = this.period === monthKey();
        const end = new Date(`${this.period}-01T00:00:00`);
        end.setMonth(end.getMonth() + 1);
        end.setDate(0);
        const to = isThisMonth ? localDate() : end.toISOString().slice(0, 10);
        return { from, to };
    }

    async load() {
        const panel = this.container.querySelector('[data-role="panel"]');
        render(panel, html`<div class="v3-skeleton">Loading…</div>`);
        const branchId = session.branch();
        const { from, to } = this.range();

        try {
            if (this.tab === 'position') {
                // The ledger totals are fetched alongside the P&L purely to
                // compare them — see reconciliation() below. One extra read on
                // a tab that already does three, in exchange for never printing
                // a net figure the ledger contradicts without saying so.
                const [position, pl, series, ledger] = await Promise.all([
                    currentMonthPosition(branchId),
                    profitAndLoss({ from, to, branchId }),
                    monthlySeries(6, branchId),
                    ledgerView({ from, to, branchId })
                ]);
                this.data = { position, pl, series, ledger };
            } else if (this.tab === 'expenses') {
                const [breakdown, rows] = await Promise.all([
                    expenseBreakdown({ from, to, branchId }),
                    listExpenses({ from, to, branchId })
                ]);
                this.data = { breakdown, expenses: rows };
            } else if (this.tab === 'ledger') {
                this.data = { ledger: await ledgerView({ from, to, branchId }) };
            } else if (this.tab === 'payroll') {
                /*
                 * preparePayroll() is NOT called here, and that is the whole
                 * point of this branch existing.
                 *
                 * Despite the name it is a WRITE: it creates a salary row for
                 * every active staff member who does not already have one for
                 * the period. Calling it on tab-open would mean that merely
                 * *looking* at Payroll silently created records — and it also
                 * requires `finance.edit`, so a view-only user could not open
                 * the tab at all.
                 *
                 * So the tab opens empty and explains itself, and preparing is
                 * an explicit act behind a button. `alreadyPrepared` on the
                 * result then distinguishes "this month was already run" from
                 * "these rows were just created".
                 */
                this.data = { payroll: this.data.payroll ?? null };
            }
            if (this.disposed) return;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error(`Finance tab "${this.tab}" failed`, err);
            render(panel, html`<div class="v3-error">This section could not be loaded — ${err.message}</div>`);
        }
    }

    paint() {
        this.container.querySelectorAll('[data-action="tab"]').forEach((n) => {
            n.setAttribute('aria-selected', n.dataset.tab === this.tab ? 'true' : 'false');
        });
        const { from, to } = this.range();
        render(this.container.querySelector('[data-role="subtitle"]'),
            `${formatDateLong(from)} to ${formatDateLong(to)}`);
        render(this.container.querySelector('[data-role="panel"]'), this.panelFor(this.tab));
    }

    panelFor(tab) {
        if (tab === 'position') return this.positionPanel();
        if (tab === 'expenses') return this.expensesPanel();
        if (tab === 'ledger') return this.ledgerPanel();
        if (tab === 'payroll') return this.payrollPanel();
        return '';
    }

    /* -------------------------------------------------------------- POSITION */

    /**
     * Does the P&L agree with the ledger it is derived from?
     *
     * 🔴 On the real data it does not, and the gap is material. July 2026:
     * the P&L reports a **+₹13,795 profit** while the ledger reports a
     * **−₹28,205 loss**, ₹42,000 apart.
     *
     * The cause is `profitAndLoss()`'s filter, inherited from the reference
     * project:
     *
     *     .filter((e) => !e.reversedBy || e.sourceType === 'reversal')
     *
     * When an entry is reversed there are two rows: the original, and a contra
     * of the opposite type. That filter drops the original but **keeps the
     * contra** — so reversing a ₹42,000 salary expense leaves a ₹42,000 credit
     * sitting in the *income* column, and July's P&L duly lists "Salaries" as
     * an income account. Both sides of a reversal should be dropped; they exist
     * to cancel, not to be counted once each on opposite sides.
     *
     * This page does not silently correct the service — an accounting rule is
     * not a UI decision, and the same bug is in the reference project. It
     * surfaces the disagreement instead, so nobody reads a profit off a screen
     * whose own ledger says loss. Flagged in MIGRATION_CHECKLIST.md for a call.
     */
    reconciliation() {
        const { pl, ledger } = this.data;
        if (!pl || !ledger) return null;
        if (pl.net === ledger.totals.net) return null;
        return {
            plNet: pl.net,
            ledgerNet: ledger.totals.net,
            gap: Math.abs(pl.net - ledger.totals.net)
        };
    }

    positionPanel() {
        const { position: p, pl, series } = this.data;
        if (!pl) return html`<div class="v3-empty">Nothing to show.</div>`;

        const peak = Math.max(1, ...(series || []).map((m) => Math.max(m.income, m.expense)));
        const gap = this.reconciliation();

        return html`
            ${gap ? html`
                <div class="v3-notice" data-tone="negative" style="margin-bottom:var(--space-4);">
                    <strong>These figures do not reconcile with the ledger.</strong>
                    This summary shows a net of ${formatMoney(gap.plNet)}; the ledger for the same
                    range shows ${formatMoney(gap.ledgerNet)} — a difference of ${formatMoney(gap.gap)}.
                    It is caused by how reversed entries are counted: the reversed entry is
                    excluded but its correcting entry is not, so a reversal lands on the opposite
                    side of the books instead of cancelling out. <strong>Trust the Ledger tab
                    until this is settled.</strong>
                </div>
            ` : ''}

            <div class="v3-kpis">
                ${kpi('Income', formatMoney(pl.totalIncome), 'positive', deltaNote(p?.change?.income))}
                ${kpi('Spending', formatMoney(pl.totalExpense), 'neutral', deltaNote(p?.change?.expense))}
                ${kpi('Net', formatMoney(pl.net), pl.net >= 0 ? 'positive' : 'negative',
                      pl.margin === null ? 'No income yet' : `${pl.margin}% margin`)}
                ${kpi('Entries', formatNumber(pl.entryCount), 'neutral', 'Posted in this range')}
            </div>

            ${series?.length ? html`
                <section class="v3-card">
                    <div class="v3-card-head"><h2 class="v3-card-title">Last six months</h2></div>
                    <!--
                        Bars drawn as divs rather than a chart library: ui/chart.js
                        belongs to v2's stylesheet, which this app never loads, and
                        six months of two figures does not justify a dependency.
                    -->
                    <div class="v3-list">
                        ${series.map((m) => html`
                            <div class="v3-row">
                                <div class="v3-row-main">
                                    <div class="v3-row-title">${m.label || m.period}</div>
                                    <div class="v3-trend">
                                        <span class="v3-trend-bar" data-tone="positive"
                                              style="width:${Math.round((m.income / peak) * 100)}%"
                                              title="Income ${formatMoney(m.income)}"></span>
                                        <span class="v3-trend-bar" data-tone="negative"
                                              style="width:${Math.round((m.expense / peak) * 100)}%"
                                              title="Spending ${formatMoney(m.expense)}"></span>
                                    </div>
                                </div>
                                <span class="v3-chip" data-fee="${m.net >= 0 ? 'clear' : 'overdue'}">
                                    ${formatMoney(m.net)}
                                </span>
                            </div>
                        `)}
                    </div>
                </section>
            ` : ''}

            <div class="v3-two-col">
                ${accountCard('Where income came from', pl.income)}
                ${accountCard('Where it went', pl.expense)}
            </div>
        `;
    }

    /* -------------------------------------------------------------- SPENDING */

    expensesPanel() {
        const { breakdown, expenses } = this.data;
        if (!breakdown) return html`<div class="v3-empty">Nothing to show.</div>`;

        return html`
            <div class="v3-kpis">
                ${kpi('Spent', formatMoney(breakdown.total), 'neutral',
                      `${formatNumber(breakdown.count)} entr${breakdown.count === 1 ? 'y' : 'ies'}`)}
                ${(breakdown.categories || []).slice(0, 3).map((c) =>
                    kpi(c.category, formatMoney(c.amount), 'neutral', `${c.share}% of spending`))}
            </div>

            <section class="v3-card">
                <div class="v3-card-head">
                    <h2 class="v3-card-title">Every expense in this range</h2>
                    <p class="v3-card-note">
                        Shown as rows, not only as category totals — a mistyped amount is
                        invisible in an aggregate and cannot be corrected from one.
                    </p>
                    <p class="v3-card-note">
                        <!--
                            These figures are recorded expenses only, and will not match
                            total spending on the This-month tab. That tab reads the ledger,
                            which also carries payroll and anything posted directly to it.
                            Both are correct; they answer different questions, so the screen
                            says which is which rather than leaving two totals to be
                            reconciled by guesswork.
                        -->
                        <strong>Recorded expenses only.</strong> Payroll and entries posted
                        straight to the ledger are not here — the This-month tab's spending
                        figure covers those too, which is why it is larger.
                    </p>
                </div>
                ${expenses?.length ? html`
                    <div class="v3-roll">
                        ${expenses.map((e) => html`
                            <div class="v3-roll-row" data-static>
                                <span class="v3-roll-main">
                                    <span class="v3-roll-name">${e.description || e.category}</span>
                                    <span class="v3-roll-meta">
                                        ${e.category} · ${formatDateLong(e.date)}${e.paidTo ? ` · ${e.paidTo}` : ''}
                                    </span>
                                </span>
                                <span class="v3-chip">${formatMoney(e.amount)}</span>
                                ${session.can(CAPABILITIES.FINANCE_EDIT) ? html`
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="edit-expense"
                                            data-id="${e.id}">
                                        Edit
                                    </button>
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="remove-expense"
                                            data-id="${e.id}" data-label="${e.description || e.category}">
                                        Remove
                                    </button>
                                ` : ''}
                            </div>
                        `)}
                    </div>
                ` : html`<div class="v3-empty">Nothing recorded in this range.</div>`}
            </section>
        `;
    }

    /* ---------------------------------------------------------------- LEDGER */

    ledgerPanel() {
        const l = this.data.ledger;
        if (!l) return html`<div class="v3-empty">Nothing to show.</div>`;

        return html`
            <div class="v3-kpis">
                ${kpi('Income', formatMoney(l.totals.income), 'positive')}
                ${kpi('Expenditure', formatMoney(l.totals.expense), 'neutral')}
                ${kpi('Net', formatMoney(l.totals.net), l.totals.net >= 0 ? 'positive' : 'negative')}
                ${kpi('Accounts touched', formatNumber(l.accounts.length), 'neutral',
                      l.accounts.slice(0, 3).join(' · ') || '—')}
            </div>

            <section class="v3-card">
                <div class="v3-card-head">
                    <h2 class="v3-card-title">Ledger</h2>
                    <p class="v3-card-note">
                        Append-only. A mistake is corrected by reversing it, which writes a
                        contra entry — the original stays. Entries posted automatically by a
                        payment or an expense are reversed from that record, not here.
                    </p>
                </div>
                ${l.rows.length ? html`
                    <div class="v3-roll">
                        ${l.rows.map((r) => html`
                            <div class="v3-roll-row" data-static>
                                <span class="v3-roll-main">
                                    <span class="v3-roll-name">${r.narration}</span>
                                    <span class="v3-roll-meta">
                                        ${formatDateLong(r.date)} · ${r.account}
                                        · ${r.sourceType ? `auto (${r.sourceType})` : 'manual entry'}
                                    </span>
                                </span>
                                <!--
                                    Sign comes from the AMOUNT, not the type. A
                                    reversal is now a contra entry — the original
                                    type with a negative amount — so keying the
                                    sign off the type would have printed
                                    "+₹-1,500" on the very row that reduces
                                    income.
                                -->
                                <span class="v3-chip" data-fee="${r.amount < 0 ? 'overdue' : r.type === 'income' ? 'clear' : 'overdue'}">
                                    ${r.amount < 0 ? '−' : r.type === 'income' ? '+' : '−'}${formatMoney(Math.abs(r.amount))}
                                </span>
                                <span class="v3-chip">${formatMoney(r.balance)}</span>
                                ${session.can(CAPABILITIES.FINANCE_EDIT)
                                    && !r.sourceType && !r.reversed && !r.reversalOf ? html`
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="reverse"
                                            data-id="${r.id}" data-label="${r.narration}">Reverse</button>
                                ` : ''}
                                ${r.sourceType && !r.reversed && !r.reversalOf ? html`
                                    <span class="v3-chip" title="Auto-posted from a ${r.sourceType}. Reverse the ${r.sourceType === 'payment' ? 'payment' : 'source record'} instead.">auto</span>
                                ` : ''}
                            </div>
                        `)}
                    </div>
                ` : html`<div class="v3-empty">No entries in this range.</div>`}
            </section>
        `;
    }

    /* --------------------------------------------------------------- PAYROLL */

    payrollPanel() {
        const p = this.data.payroll;

        if (!p) {
            return html`
                <section class="v3-card">
                    <div class="v3-card-head">
                        <h2 class="v3-card-title">Payroll for ${this.period}</h2>
                        <p class="v3-card-note">
                            Preparing payroll creates a salary line for every active staff member
                            with a monthly salary set. It is a write, so it happens when you ask
                            for it — not when you open this tab.
                        </p>
                    </div>
                    <div class="v3-card-body">
                        ${session.can(CAPABILITIES.FINANCE_EDIT) ? html`
                            <button class="v3-action-btn v3-btn-md" data-action="prepare-payroll">
                                Prepare ${this.period} payroll
                            </button>
                        ` : html`
                            <p class="v3-modal-note">
                                Preparing payroll needs the finance-edit permission, which your
                                role does not carry.
                            </p>
                        `}
                    </div>
                </section>
            `;
        }

        // preparePayroll() returns { period, lines, gross, net, alreadyPrepared }.
        const rows = p.lines || [];
        const unpaid = rows.filter((r) => r.status !== 'paid');

        return html`
            <div class="v3-kpis">
                ${kpi('On payroll', formatNumber(rows.length), 'neutral', `For ${this.period}`)}
                ${kpi('Total', formatMoney(rows.reduce((s, r) => s + (r.net ?? r.gross ?? 0), 0)), 'neutral')}
                ${kpi('Paid', formatNumber(rows.length - unpaid.length),
                      unpaid.length ? 'caution' : 'positive',
                      unpaid.length ? `${unpaid.length} still to pay` : 'Everyone paid')}
            </div>

            <section class="v3-card">
                <div class="v3-card-head">
                    <h2 class="v3-card-title">${this.period} payroll</h2>
                    ${session.can(CAPABILITIES.FINANCE_EDIT) && unpaid.length ? html`
                        <button class="v3-action-btn v3-btn-sm" data-action="pay-all">
                            Pay ${unpaid.length} · ${formatMoney(unpaid.reduce((s, r) => s + (r.net ?? r.gross ?? 0), 0))}
                        </button>
                    ` : ''}
                </div>
                ${rows.length ? html`
                    <div class="v3-roll">
                        ${rows.map((r) => html`
                            <div class="v3-roll-row" data-static>
                                <span class="v3-roll-main">
                                    <span class="v3-roll-name">${r.staffName || r.name || 'Staff'}</span>
                                    <span class="v3-roll-meta">
                                        Gross ${formatMoney(r.gross || 0)}
                                        ${r.allowances ? ` · allowances ${formatMoney(r.allowances)}` : ''}
                                        ${r.deductions ? ` · deductions ${formatMoney(r.deductions)}` : ''}
                                    </span>
                                </span>
                                <span class="v3-chip" data-fee="${r.status === 'paid' ? 'clear' : 'overdue'}">
                                    ${r.status === 'paid' ? 'Paid' : 'Due'}
                                </span>
                                <span class="v3-chip">${formatMoney(r.net ?? r.gross ?? 0)}</span>
                            </div>
                        `)}
                    </div>
                ` : html`
                    <div class="v3-empty">
                        Nobody on payroll for ${this.period} — staff need a monthly salary set.
                    </div>
                `}
            </section>
        `;
    }

    /* ----------------------------------------------------------------- WRITES */

    async postManualEntry() {
        session.require(CAPABILITIES.FINANCE_EDIT, 'post a ledger entry');
        const branches = await listBranches();

        const posted = await formModal({
            title: 'Post a ledger entry',
            description: 'For a donation, a ticket sale or a correction. Entries made by '
                       + 'another module carry their own source and are not typed here.',
            submitLabel: 'Post',
            fields: [
                { name: 'type', label: 'Kind', type: 'select', required: true,
                  options: [
                      { value: 'income', label: 'Income — money in' },
                      { value: 'expense', label: 'Expenditure — money out' }
                  ] },
                // The account list depends on the kind, and the service rejects
                // an account that does not belong to it — so both lists are
                // rendered and one is hidden, rather than a single list that
                // could offer an invalid pairing.
                { name: 'incomeAccount', label: 'Account', type: 'select', required: true,
                  placeholder: 'Choose an account',
                  options: ACCOUNTS.income.map((a) => ({ value: a, label: a })),
                  showIf: (v) => v.type === 'income' },
                { name: 'expenseAccount', label: 'Account', type: 'select', required: true,
                  placeholder: 'Choose an account',
                  options: ACCOUNTS.expense.map((a) => ({ value: a, label: a })),
                  showIf: (v) => v.type === 'expense' },
                { name: 'amount', label: 'Amount', type: 'money', required: true, min: 1 },
                { name: 'date', label: 'Date', type: 'date',
                  validate: (v) => v && v > localDate() ? 'A ledger entry cannot be dated in the future.' : null },
                { name: 'narration', label: 'What it is for', required: true,
                  placeholder: 'Donation from the Iyer family' },
                { name: 'branchId', label: 'Branch', type: 'select', placeholder: 'Whole school',
                  options: branches.map((b) => ({ value: b.id, label: b.name })) }
            ],
            values: {
                type: 'income', incomeAccount: '', expenseAccount: '',
                amount: '', date: localDate(), narration: '', branchId: session.branch() || ''
            },
            onSubmit: (v) => postEntry({
                type: v.type,
                account: v.type === 'income' ? v.incomeAccount : v.expenseAccount,
                amount: v.amount,
                date: v.date || null,
                narration: v.narration,
                branchId: v.branchId || null
            })
        });

        if (!posted) return;
        toast.success('Entry posted', posted.narration);
        await this.load();
    }

    /**
     * Reversing an entry.
     *
     * `reverseEntry()` writes a contra entry — it never edits or removes the
     * original. The dialog says so explicitly, because "reverse" reads like
     * "undo" and the difference matters to anyone reconciling later.
     */
    async reverseLedgerEntry(id, label) {
        const done = await formModal({
            title: 'Reverse this entry',
            description: `"${label}". The original stays on the ledger — a matching contra `
                       + 'entry is added, so both are visible and the totals correct themselves.',
            submitLabel: 'Post the reversal',
            fields: [
                { name: 'reason', label: 'Why', required: true,
                  placeholder: 'Posted twice, wrong account…',
                  help: 'Carried on the reversing entry.' }
            ],
            values: { reason: '' },
            onSubmit: (v) => reverseEntry(id, { reason: v.reason })
        });

        if (!done) return;
        toast.success('Reversal posted');
        await this.load();
    }

    /**
     * One form for recording spending and for editing it afterwards.
     *
     * Every field the Record spending dialog offers is editable later — the
     * request was "everything in this should be editable and delete", and the
     * cheapest way to guarantee that stays true is for both to be the same
     * field list rather than two that drift.
     *
     * updateExpense() rewrites the linked ledger entry in the same transaction
     * (see its own body), so correcting a mistyped amount or a wrong category
     * moves the books with it. That is why editing an EXPENSE is safe where
     * editing a raw ledger line is not: the expense owns its ledger entry.
     *
     * @param {object|null} existing  the expense being edited, or null to record a new one.
     */
    async expenseForm(existing = null) {
        session.require(CAPABILITIES.FINANCE_EDIT, existing ? 'edit an expense' : 'record an expense');
        const branches = await listBranches();

        const saved = await formModal({
            title: existing ? 'Edit spending' : 'Record spending',
            description: existing
                ? 'Changes the expense and its ledger entry together, in one transaction.'
                : 'Writes the expense and its ledger entry together, in one transaction.',
            submitLabel: existing ? 'Save changes' : 'Record',
            fields: [
                /*
                 * expenseCategories(), NOT ACCOUNTS.expense. The two differ by
                 * exactly one entry: ACCOUNTS.expense prepends "Salaries" so the
                 * payroll run has a ledger account to post against, but
                 * recordExpense() validates against expenseCategories() and
                 * would reject it. Salaries are paid through payroll, not typed
                 * in here as an ad-hoc expense.
                 */
                { name: 'category', label: 'Category', type: 'select', required: true,
                  placeholder: 'Choose a category',
                  options: expenseCategories().map((a) => ({ value: a, label: a })) },
                { name: 'amount', label: 'Amount', type: 'money', required: true, min: 1 },
                { name: 'date', label: 'Date', type: 'date',
                  validate: (v) => v && v > localDate() ? 'Spending cannot be dated in the future.' : null },
                { name: 'description', label: 'What for', required: true,
                  placeholder: 'Costume hire for Annual Day' },
                { name: 'paidTo', label: 'Paid to' },
                // Required: recordExpense() refuses an expense with no branch
                // ("Choose which branch this expense belongs to"), unlike a
                // manual ledger entry, which may be school-wide.
                { name: 'branchId', label: 'Branch', type: 'select', required: true,
                  placeholder: 'Choose a branch',
                  options: branches.map((b) => ({ value: b.id, label: b.name })) }
            ],
            values: existing ? {
                category: existing.category || '',
                amount: existing.amount ?? '',
                date: existing.date || localDate(),
                description: existing.description || '',
                paidTo: existing.paidTo || '',
                branchId: existing.branchId || ''
            } : {
                category: '', amount: '', date: localDate(),
                description: '', paidTo: '', branchId: session.branch() || ''
            },
            onSubmit: (v) => (existing ? updateExpense(existing.id, v) : recordExpense(v))
        });

        if (!saved) return;
        toast.success(existing ? 'Spending updated' : 'Spending recorded');
        await this.load();
    }

    /** Kept as the name the "Record spending" button binds to. */
    addExpense() { return this.expenseForm(null); }

    editExpense(id) {
        // this.data.expenses — the Spending tab's own rows, which is the only
        // tab this button appears on.
        const expense = (this.data?.expenses || []).find((e) => e.id === id);
        if (!expense) return undefined;
        return this.expenseForm(expense);
    }

    async deleteExpense(id, label) {
        const done = await formModal({
            title: 'Remove this expense',
            description: `"${label}". Its ledger entry is reversed at the same time, so the `
                       + 'books stay balanced.',
            submitLabel: 'Remove',
            fields: [
                { name: 'reason', label: 'Why', required: true, placeholder: 'Entered twice, wrong amount…' }
            ],
            values: { reason: '' },
            onSubmit: (v) => removeExpense(id, { reason: v.reason })
        });

        if (!done) return;
        toast.success('Expense removed');
        await this.load();
    }

    /**
     * Paying the month's salaries.
     *
     * One confirm, one call: `paySalaries()` posts every salary and its ledger
     * entries in a single transaction, so there is no partial state to explain
     * and no per-row payment for someone to half-finish.
     */
    /** Creates the month's salary lines. A write, so it is an explicit action. */
    async prepareThisPayroll() {
        session.require(CAPABILITIES.FINANCE_EDIT, 'prepare payroll');
        try {
            const payroll = await preparePayroll(this.period, { branchId: session.branch() });
            this.data = { ...this.data, payroll };
            this.paint();
            toast.success(
                payroll.alreadyPrepared ? `${this.period} was already prepared` : 'Payroll prepared',
                `${payroll.lines.length} ${payroll.lines.length === 1 ? 'line' : 'lines'} · ${formatMoney(payroll.net)}`);
        } catch (err) {
            toast.error(err.message);
        }
    }

    async payPayroll() {
        const rows = (this.data.payroll?.lines || []).filter((r) => r.status !== 'paid');
        if (!rows.length) return;

        const total = rows.reduce((s, r) => s + (r.net ?? r.gross ?? 0), 0);

        const done = await formModal({
            title: `Pay ${this.period} salaries`,
            description: `${rows.length} ${rows.length === 1 ? 'person' : 'people'}, `
                       + `${formatMoney(total)} in total. Posted to the ledger as one run.`,
            submitLabel: 'Pay',
            fields: [
                { name: 'mode', label: 'Paid by', type: 'select',
                  options: [
                      { value: 'bank', label: 'Bank transfer' },
                      { value: 'cash', label: 'Cash' },
                      { value: 'cheque', label: 'Cheque' }
                  ] },
                { name: 'paidOn', label: 'Paid on', type: 'date',
                  validate: (v) => v && v > localDate() ? 'Payment cannot be dated in the future.' : null }
            ],
            values: { mode: 'bank', paidOn: localDate() },
            onSubmit: async (v) => {
                const ok = await confirmModal({
                    title: `Pay ${formatMoney(total)}?`,
                    message: `${rows.length} ${rows.length === 1 ? 'salary' : 'salaries'} will be marked paid `
                           + 'and posted to the ledger in one transaction. Correcting it afterwards means '
                           + 'reversing entries, not deleting them.',
                    confirmLabel: 'Pay them',
                    tone: 'caution'
                });
                if (!ok) throw new Error('Not paid. Nothing has changed.');
                return paySalaries(rows.map((r) => r.id), { paidOn: v.paidOn || null, mode: v.mode });
            }
        });

        if (!done) return;
        toast.success('Payroll paid', `${rows.length} · ${formatMoney(total)}`);
        await this.load();
    }

    bind() {
        const root = this.container;

        this.onDispose(on(root, 'click', '[data-action="tab"]', (_e, t) => {
            if (this.tab === t.dataset.tab) return;
            this.tab = t.dataset.tab;
            this.load();
        }));
        this.onDispose(on(root, 'change', '[data-role="period"]', (_e, t) => {
            if (!t.value) return;
            this.period = t.value;
            this.load();
        }));

        this.onDispose(on(root, 'click', '[data-action="post-entry"]', () => this.postManualEntry()));
        this.onDispose(on(root, 'click', '[data-action="add-expense"]', () => this.addExpense()));
        this.onDispose(on(root, 'click', '[data-action="edit-expense"]', (_e, t) => this.editExpense(t.dataset.id)));
        this.onDispose(on(root, 'click', '[data-action="prepare-payroll"]', () => this.prepareThisPayroll()));
        this.onDispose(on(root, 'click', '[data-action="pay-all"]', () => this.payPayroll()));
        this.onDispose(on(root, 'click', '[data-action="reverse"]', (_e, t) =>
            this.reverseLedgerEntry(t.dataset.id, t.dataset.label)));
        this.onDispose(on(root, 'click', '[data-action="remove-expense"]', (_e, t) =>
            this.deleteExpense(t.dataset.id, t.dataset.label)));
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

/** "+12% on last month", or nothing when there is no comparison to make. */
function deltaNote(change) {
    if (change === null || change === undefined) return null;
    if (!Number.isFinite(change)) return 'No figure last month';
    const rounded = Math.round(change);
    if (rounded === 0) return 'Level with last month';
    return `${rounded > 0 ? '+' : ''}${rounded}% on last month`;
}

function accountCard(title, accounts) {
    const rows = accounts || [];
    return html`
        <section class="v3-card">
            <div class="v3-card-head"><h2 class="v3-card-title">${title}</h2></div>
            ${rows.length ? html`
                <div class="v3-list">
                    ${rows.map((a) => html`
                        <div class="v3-row">
                            <div class="v3-row-main"><div class="v3-row-title">${a.account}</div></div>
                            <span class="v3-chip">${formatMoney(a.amount)}</span>
                        </div>
                    `)}
                </div>
            ` : html`<div class="v3-empty">Nothing in this range.</div>`}
        </section>
    `;
}

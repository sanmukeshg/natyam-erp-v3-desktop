/**
 * Natyam ERP v3 — Admin — Finance
 *
 * A CASHBOOK WITH THE BOOKS BEHIND IT — UAT5 ENH-504.
 *
 * Four tabs, in the order the work happens: Dashboard (how the month stands),
 * Transactions (what moved, and fix it), Payroll (pay people), Advanced
 * accounting (the ledger, reversals, the audit trail).
 *
 * The last of those used to be second and was called "Ledger". Nothing in it
 * changed — the same rows, the same Edit, Delete and Reverse, the same
 * append-only rule — but it is no longer what an owner meets on the way to
 * recording a taxi fare. Everyday money is Transactions; the ledger is for the
 * month-end and the mistake, and it says so.
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
// The last five are the cashbook layer — UAT5 ENH-504. Same ledger underneath;
// they read and write it in the owner's vocabulary rather than an accountant's.
//
// The comment sits above the statement rather than inside the braces because
// tools/verify-imports.cjs reads this list with a regex and takes a comment
// between the braces as part of a binding name.
import {
    ACCOUNTS, currentMonthPosition, profitAndLoss,
    ledgerView, preparePayroll,
    postEntry, updateEntry, deleteEntry, reverseEntry,
    recordExpense, getExpense, updateExpense, removeExpense, paySalaries,
    transactions, moneyOutBreakdown, recordTransaction, updateTransaction, deleteTransaction
} from '../../services/finance.service.js';
import { listBranches } from '../../services/settings.service.js';
import { formModal, confirmModal } from '../../ui/form.js';

/*
 * No Spending tab. Everything is tracked in the Ledger, by decision.
 *
 * It read from expense RECORDS while the Ledger read from ledger ENTRIES, so
 * spending typed straight into the ledger — and payroll — never appeared on it.
 * Its own note admitted as much. A tab called Spending showing ₹0 while
 * Expenditure showed ₹12,000 is worse than no tab, and with the Ledger now
 * carrying Edit and Delete on every row it types itself, there is nothing the
 * Spending tab could do that the Ledger cannot.
 *
 * expensesPanel() and its service calls are gone with it. recordExpense() stays
 * — "Record spending" still captures a category and a payee, which a bare
 * ledger line has no field for, and its entry lands in the Ledger like any
 * other.
 */

/*
 * UAT5 ENH-504 — Dashboard and Transactions first, the Ledger last.
 *
 * The order is the enhancement, and it is only an order. Nothing has been
 * removed: the Ledger keeps every row, every Edit, every Reverse, and the
 * append-only rule it is built on. It stops being the second thing an owner
 * sees, because for the daily job — what came in, what went out, correct that
 * typo — it is the wrong tool, and the right one did not exist.
 *
 * "Advanced accounting" rather than "Ledger" as the label, on the same
 * reasoning the Owner gave: it should not dominate the interface but it must
 * stay reachable. A tab named for what it is FOR tells someone who does not
 * need it that they do not need it, which a tab named "Ledger" does not.
 *
 * It carries no capability of its own. Its contents were always gated by
 * `finance.edit` per row and the page by `finance.view`, and moving a tab is
 * not the place to change who can read the books.
 */
const TABS = [
    { key: 'position', label: 'Dashboard' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'ledger', label: 'Advanced accounting' }
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
                <!--
                    UAT5 ENH-504 — the actions belong to the tab, not to the page.

                    "Record spending" and "Post entry" used to sit here on every
                    tab, including Payroll, where neither means anything. They
                    are the same two writes as before; each now appears where it
                    is the thing you came to do, which is also what keeps the
                    ledger's raw Post entry out of the everyday view.
                -->
                <div class="v3-head-actions" data-role="actions">
                    <input class="v3-branch-select" type="month" data-role="period" value="${this.period}"
                           max="${monthKey()}" aria-label="Month">
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
                // monthlySeries() is no longer among them: the six-month block
                // it fed moved to Analytics with ENH-504 Part 2, so this tab
                // stopped paying for a query whose output it no longer draws.
                const [position, pl, ledger] = await Promise.all([
                    currentMonthPosition(branchId),
                    profitAndLoss({ from, to, branchId }),
                    ledgerView({ from, to, branchId })
                ]);
                this.data = { position, pl, ledger };
            } else if (this.tab === 'transactions') {
                const [pl, ledger, breakdown] = await Promise.all([
                    profitAndLoss({ from, to, branchId }),
                    transactions({ from, to, branchId }),
                    moneyOutBreakdown({ from, to, branchId })
                ]);
                this.data = { pl, cashbook: ledger, breakdown };
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
        this.paintActions();
        render(this.container.querySelector('[data-role="panel"]'), this.panelFor(this.tab));
    }

    /**
     * The header's action buttons, chosen by tab.
     *
     * The month picker is rendered once and left alone — it applies to every
     * tab, and re-rendering it would throw away a half-typed month.
     */
    paintActions() {
        const host = this.container.querySelector('[data-role="actions"]');
        if (!host) return;

        host.querySelectorAll('[data-role="tab-action"]').forEach((node) => node.remove());
        if (!session.can(CAPABILITIES.FINANCE_EDIT)) return;

        const buttons = this.tab === 'transactions'
            ? html`<button class="v3-action-btn v3-btn-md" data-role="tab-action"
                           data-action="add-transaction">Add transaction</button>`
            : this.tab === 'ledger'
                ? html`<button class="v3-action-btn v3-btn-md" data-role="tab-action"
                               data-action="post-entry">Post entry</button>`
                : '';

        if (buttons) host.insertAdjacentHTML('beforeend', String(buttons));
    }

    panelFor(tab) {
        if (tab === 'position') return this.positionPanel();
        if (tab === 'transactions') return this.transactionsPanel();
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
        const { position: p, pl } = this.data;
        if (!pl) return html`<div class="v3-empty">Nothing to show.</div>`;

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

            <!--
                UAT5 ENH-504 Part 2 — the six-month block is on Analytics now.

                Six months of two figures was never wrong, only stranded: it
                could not be widened, narrowed or dated, because this tab is
                fixed to one month. Analytics already owned ranges and now owns
                a Money series drawing exactly these bars over 30 days to any
                custom window. Keeping a second, poorer copy here would mean two
                screens answering the same question differently.
            -->
            ${session.can(CAPABILITIES.REPORT_VIEW) ? html`
                <section class="v3-card">
                    <div class="v3-card-head">
                        <h2 class="v3-card-title">Trends</h2>
                        <p class="v3-card-note">
                            Money in against money out, over any range — 30 days to a custom window.
                        </p>
                    </div>
                    <div class="v3-card-body">
                        <a class="v3-ghost-btn" href="#/analytics?series=money&months=6">View trends</a>
                    </div>
                </section>
            ` : ''}

            <div class="v3-two-col">
                ${accountCard('Where income came from', pl.income)}
                ${accountCard('Where it went', pl.expense)}
            </div>
        `;
    }

    /* ---------------------------------------------------------- TRANSACTIONS */

    /**
     * The cashbook — UAT5 ENH-504 Part 1.
     *
     * Everything the school's money did this month, newest first, in the words
     * an owner uses for it. Money in, money out, and Edit or Delete on the two
     * kinds that can honestly carry them.
     *
     * WHY NOT JUST USE THE LEDGER? Because the ledger's job is to be complete
     * and permanent, and this one's is to be worked in. It shows a running
     * balance, both halves of every reversal, and an account column, all of
     * which are correct and none of which help someone fixing yesterday's taxi
     * fare. transactions() drops the reversal pairs so the list adds up to the
     * Net above it; ledgerView() keeps them because that is the audit trail.
     * Same books, two readings, and the Advanced tab still has the other one.
     */
    transactionsPanel() {
        const { pl, cashbook, breakdown } = this.data;
        if (!cashbook) return html`<div class="v3-empty">Nothing to show.</div>`;

        const canEdit = session.can(CAPABILITIES.FINANCE_EDIT);
        const rows = cashbook.rows || [];

        return html`
            <div class="v3-kpis">
                ${kpi('Money in', formatMoney(cashbook.income), 'positive')}
                ${kpi('Money out', formatMoney(cashbook.expense), 'neutral', 'Payroll included')}
                ${kpi('Net', formatMoney(cashbook.net), cashbook.net >= 0 ? 'positive' : 'negative',
                      pl?.margin === null || pl?.margin === undefined ? '' : `${pl.margin}% margin`)}
                ${kpi('Transactions', formatNumber(rows.length), 'neutral', `In ${formatDateLong(this.range().from)}’s month`)}
            </div>

            ${breakdown?.categories?.length ? html`
                <section class="v3-card">
                    <div class="v3-card-head">
                        <h2 class="v3-card-title">Where it went</h2>
                        <!--
                            Part 3 of the enhancement, and the reason this reads the
                            ledger rather than the expenses collection: payroll never
                            wrote to that collection, so the wage bill — the school's
                            largest outgoing — was missing from this list entirely.
                        -->
                        <p class="v3-card-note">
                            Every rupee out, payroll and hand-posted entries included.
                        </p>
                    </div>
                    <div class="v3-card-body">
                        ${breakdown.categories.map((c) => html`
                            <div class="v3-meter">
                                <div class="v3-meter-head">
                                    <span>${c.category}</span>
                                    <span>${formatMoney(c.amount)} · ${c.share}%</span>
                                </div>
                                <div class="v3-meter-track">
                                    <div class="v3-meter-fill" style="width:${c.share}%;"></div>
                                </div>
                            </div>
                        `)}
                    </div>
                </section>
            ` : ''}

            <section class="v3-card">
                <div class="v3-card-head">
                    <h2 class="v3-card-title">Transactions</h2>
                    <p class="v3-card-note">
                        Money in and money out together. A fee payment, a salary or a reversal is
                        corrected from the record that created it — the row says which.
                    </p>
                </div>
                ${rows.length ? html`
                    <div class="v3-roll">
                        ${rows.map((r) => html`
                            <div class="v3-roll-row" data-static>
                                <span class="v3-roll-main">
                                    <span class="v3-roll-name">${r.description || r.category}</span>
                                    <span class="v3-roll-meta">
                                        ${formatDateLong(r.date)} · ${r.category}${
                                            r.editable ? '' : ` · ${r.lockedReason}`
                                        }
                                    </span>
                                </span>
                                <span class="v3-chip" data-fee="${r.type === 'income' ? 'clear' : 'overdue'}">
                                    ${r.type === 'income' ? '+' : '−'}${formatMoney(r.amount)}
                                </span>
                                ${canEdit && r.editable ? html`
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="edit-transaction"
                                            data-id="${r.id}">Edit</button>
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="delete-transaction"
                                            data-id="${r.id}">Delete</button>
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
                                    Math.abs guards a legacy row: entries written
                                    while reversals were briefly stored as negative
                                    income would otherwise render "+₹-1,500", which
                                    is what production showed. New rows are always
                                    positive.
                                -->
                                <span class="v3-chip" data-fee="${r.type === 'income' ? 'clear' : 'overdue'}">
                                    ${r.type === 'income' ? '+' : '−'}${formatMoney(Math.abs(r.amount))}
                                </span>
                                <span class="v3-chip">${formatMoney(r.balance)}</span>
                                ${session.can(CAPABILITIES.FINANCE_EDIT) && !r.sourceType ? html`
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="edit-entry"
                                            data-id="${r.id}">Edit</button>
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="delete-entry"
                                            data-id="${r.id}" data-label="${r.narration}">Delete</button>
                                ` : ''}
                                ${session.can(CAPABILITIES.FINANCE_EDIT) && r.sourceType === 'expense' ? html`
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="edit-expense-entry"
                                            data-id="${r.sourceId}">Edit</button>
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="remove-expense"
                                            data-id="${r.sourceId}" data-label="${r.narration}">Delete</button>
                                ` : ''}
                                ${session.can(CAPABILITIES.FINANCE_EDIT)
                                    && ['waiver', 'payment', 'refund'].includes(r.sourceType)
                                    && !r.reversed && !r.reversalOf ? html`
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="reverse"
                                            data-id="${r.id}" data-label="${r.narration}">Reverse</button>
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

    /**
     * One form for posting a hand-typed ledger entry and for correcting one.
     *
     * Both kinds are editable — money in and money out alike — because both are
     * typed by a person and a typo in either is just a typo. An entry posted by
     * another module is not offered here at all: updateEntry() refuses it, and
     * the row shows that module's own Edit instead.
     *
     * @param {object|null} existing  the entry being corrected, or null to post a new one.
     */
    async manualEntryForm(existing = null) {
        session.require(CAPABILITIES.FINANCE_EDIT, existing ? 'edit a ledger entry' : 'post a ledger entry');
        const branches = await listBranches();

        const posted = await formModal({
            title: existing ? 'Edit ledger entry' : 'Post a ledger entry',
            description: existing
                ? 'Corrects the entry in place. Only entries typed here can be edited — '
                  + 'anything posted by another module is corrected from that record.'
                : 'For a donation, a ticket sale or a correction. Entries made by '
                  + 'another module carry their own source and are not typed here.',
            submitLabel: existing ? 'Save changes' : 'Post',
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
            values: existing ? {
                type: existing.type,
                // The account lives in one field or the other depending on kind,
                // so it is seeded into the matching one and the other left blank.
                incomeAccount: existing.type === 'income' ? existing.account : '',
                expenseAccount: existing.type === 'expense' ? existing.account : '',
                amount: Math.abs(existing.amount),
                date: existing.date || localDate(),
                narration: existing.narration || '',
                branchId: existing.branchId || ''
            } : {
                type: 'income', incomeAccount: '', expenseAccount: '',
                amount: '', date: localDate(), narration: '', branchId: session.branch() || ''
            },
            onSubmit: (v) => {
                const payload = {
                    type: v.type,
                    account: v.type === 'income' ? v.incomeAccount : v.expenseAccount,
                    amount: v.amount,
                    date: v.date || null,
                    narration: v.narration,
                    branchId: v.branchId || null
                };
                return existing ? updateEntry(existing.id, payload) : postEntry(payload);
            }
        });

        if (!posted) return;
        toast.success(existing ? 'Entry updated' : 'Entry posted', posted.narration);
        await this.load();
    }

    /** Kept as the name the "Post entry" button binds to. */
    postManualEntry() { return this.manualEntryForm(null); }

    editEntry(id) {
        // `this.data.ledger.rows`, not `this.data.rows` — the latter has never
        // existed, so Edit on a hand-typed ledger row did nothing at all and
        // said nothing about it. Found while restructuring these tabs.
        const entry = (this.data?.ledger?.rows || []).find((r) => r.id === id);
        if (!entry) { toast.error('That entry is no longer on this page. Reload and try again.'); return undefined; }
        return this.manualEntryForm(entry);
    }

    /* ------------------------------------------------- CASHBOOK (ENH-504) */

    /**
     * Money in or money out, in one dialog.
     *
     * Deliberately NOT manualEntryForm(): that form speaks in ledger accounts
     * and posts a raw entry, which is the Advanced tab's job. This one asks the
     * four things the enhancement lists and lets recordTransaction() decide
     * where they land — money out through recordExpense(), so the expense record
     * and its payee survive, money in as a ledger entry.
     */
    async addTransaction() {
        session.require(CAPABILITIES.FINANCE_EDIT, 'record a transaction');
        const branches = await listBranches();

        const saved = await formModal({
            title: 'Add a transaction',
            description: 'Money out is anything the school paid for. Money in is income it received.',
            submitLabel: 'Record',
            fields: [
                { name: 'type', label: 'Kind', type: 'select', required: true,
                  options: [
                      { value: 'expense', label: 'Money out — the school paid' },
                      { value: 'income', label: 'Money in — the school received' }
                  ] },
                { name: 'date', label: 'Date', type: 'date',
                  validate: (v) => v && v > localDate() ? 'A transaction cannot be dated in the future.' : null },
                // Salaries is absent from money out on purpose — payroll already
                // posts every wage it pays, so a hand-typed one would double it.
                // See the same decision in natyam-mobile's finance page.
                { name: 'expenseCategory', label: 'Category', type: 'select', required: true,
                  placeholder: 'Choose a category',
                  options: expenseCategories().filter((c) => c !== 'Salaries').map((c) => ({ value: c, label: c })),
                  showIf: (v) => v.type === 'expense' },
                { name: 'incomeCategory', label: 'Category', type: 'select', required: true,
                  placeholder: 'Choose a category',
                  options: ACCOUNTS.income.map((c) => ({ value: c, label: c })),
                  showIf: (v) => v.type === 'income' },
                { name: 'description', label: 'What for', required: true,
                  placeholder: 'Costume hire for Annual Day' },
                { name: 'amount', label: 'Amount', type: 'money', required: true, min: 1 },
                { name: 'paidTo', label: 'Paid to', showIf: (v) => v.type === 'expense' },
                { name: 'branchId', label: 'Branch', type: 'select', required: true,
                  placeholder: 'Choose a branch',
                  options: branches.map((b) => ({ value: b.id, label: b.name })) }
            ],
            values: {
                type: 'expense', date: localDate(),
                expenseCategory: '', incomeCategory: '',
                description: '', amount: '', paidTo: '',
                branchId: session.branch() || ''
            },
            onSubmit: (v) => recordTransaction({
                type: v.type,
                category: v.type === 'income' ? v.incomeCategory : v.expenseCategory,
                amount: v.amount,
                description: v.description,
                date: v.date || null,
                branchId: v.branchId,
                paidTo: v.type === 'expense' ? v.paidTo : null
            })
        });

        if (!saved) return;
        toast.success('Transaction recorded');
        await this.load();
    }

    async editTransaction(id) {
        const row = (this.data?.cashbook?.rows || []).find((r) => r.id === id);
        if (!row) return;
        if (!row.editable) { toast.error('Cannot be edited here', row.lockedReason); return; }

        const categories = row.type === 'income'
            ? ACCOUNTS.income
            : expenseCategories().filter((c) => c !== 'Salaries');

        const saved = await formModal({
            title: 'Edit transaction',
            description: row.expenseId
                ? 'Changes the expense and its ledger entry together, in one transaction.'
                : 'Corrects the ledger entry in place.',
            submitLabel: 'Save changes',
            fields: [
                { name: 'date', label: 'Date', type: 'date',
                  validate: (v) => v && v > localDate() ? 'A transaction cannot be dated in the future.' : null },
                // The row's own category is forced in, so an entry already on an
                // account this form would not offer cannot silently lose it.
                { name: 'category', label: 'Category', type: 'select', required: true,
                  options: [...new Set([row.category, ...categories])].map((c) => ({ value: c, label: c })) },
                { name: 'description', label: 'What for', required: true },
                { name: 'amount', label: 'Amount', type: 'money', required: true, min: 1 }
            ],
            values: {
                date: row.date,
                category: row.category,
                description: row.description || '',
                amount: row.amount
            },
            onSubmit: (v) => updateTransaction(row, v)
        });

        if (!saved) return;
        toast.success('Transaction updated');
        await this.load();
    }

    async removeTransaction(id) {
        const row = (this.data?.cashbook?.rows || []).find((r) => r.id === id);
        if (!row) return;
        if (!row.editable) { toast.error('Cannot be deleted here', row.lockedReason); return; }

        const done = await formModal({
            title: 'Delete this transaction',
            description: `"${row.description || row.category}" — ${formatMoney(row.amount)}. `
                       + 'The reason is kept in the audit log.',
            submitLabel: 'Delete',
            fields: [
                { name: 'reason', label: 'Why', required: true, placeholder: 'Entered twice, wrong amount…' }
            ],
            values: { reason: '' },
            onSubmit: (v) => deleteTransaction(row, { reason: v.reason })
        });

        if (!done) return;
        toast.success('Transaction deleted');
        await this.load();
    }

    async deleteEntry(id, label) {
        const done = await formModal({
            title: 'Delete this entry',
            description: `"${label}". This removes it outright — it is a hand-typed entry, so `
                       + 'there is no other record behind it. The reason is kept in the audit log.',
            submitLabel: 'Delete',
            fields: [
                { name: 'reason', label: 'Why', required: true, placeholder: 'Entered twice, wrong amount…' }
            ],
            values: { reason: '' },
            onSubmit: (v) => deleteEntry(id, { reason: v.reason })
        });

        if (!done) return;
        toast.success('Entry deleted');
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

    /*
     * "Record spending" is gone — ENH-504. Its one job, typing money out, is
     * what Add transaction on the Transactions tab now does, through
     * recordTransaction(), which routes money out to recordExpense() anyway. So
     * this form has exactly one caller left: editing an expense that already
     * exists. Two buttons that wrote the same record was the duplication; the
     * form itself is still needed, and is still the same fields.
     */

    /** From a Ledger row, where the expense itself is not in hand. */
    async editExpenseById(id) {
        const expense = await getExpense(id).catch(() => null);
        if (!expense) { toast.error('That expense could not be found.'); return; }
        await this.expenseForm(expense);
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

        // The cashbook — ENH-504.
        this.onDispose(on(root, 'click', '[data-action="add-transaction"]', () => this.addTransaction()));
        this.onDispose(on(root, 'click', '[data-action="edit-transaction"]', (_e, t) =>
            this.editTransaction(t.dataset.id)));
        this.onDispose(on(root, 'click', '[data-action="delete-transaction"]', (_e, t) =>
            this.removeTransaction(t.dataset.id)));

        this.onDispose(on(root, 'click', '[data-action="edit-entry"]', (_e, t) => this.editEntry(t.dataset.id)));
        this.onDispose(on(root, 'click', '[data-action="delete-entry"]', (_e, t) =>
            this.deleteEntry(t.dataset.id, t.dataset.label)));
        // An expense's ledger row edits the EXPENSE, by its sourceId — that is
        // what keeps the two in step (updateExpense rewrites both together).
        this.onDispose(on(root, 'click', '[data-action="edit-expense-entry"]', (_e, t) =>
            this.editExpenseById(t.dataset.id)));
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

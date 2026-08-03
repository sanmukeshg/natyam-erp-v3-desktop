/**
 * Natyam ERP v3 — Admin — Reports
 *
 * Fourteen reports across six groups, each one a catalogue entry that declares
 * its own columns, its own filters and its own builder. This page renders that
 * declaration; it knows nothing about any individual report.
 *
 * WHY THE FILTER BAR IS BUILT FROM `report.filters`: each entry names which of
 * branch / batch / level / status it actually honours. Showing a level filter
 * on the payroll report would be a control that silently does nothing — the
 * builder never reads it — which is worse than no control at all. So the bar is
 * assembled per report rather than being one fixed set.
 *
 * THIS IS THE ONE SCREEN THAT LEGITIMATELY RENDERS A TABLE. Everywhere else in
 * v3 the design replaced tables with card lists, and rightly: a card list reads
 * better for records you scan. But a report is a grid by definition — it is
 * printed, exported to a spreadsheet, and handed to an accountant, and its
 * columns are declared by the service. Turning that into cards would make it
 * unexportable and unreadable at once. It scrolls horizontally inside its own
 * container rather than making the page scroll.
 *
 * Export and print are the service's (`downloadCSV`, `downloadSpreadsheet`,
 * `printReport`) and are handed the whole result object, so what is exported is
 * exactly what was run — not a re-query that might disagree with the screen.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatNumber } from '../../utils/money.js';
import { localDate, startOfMonth, formatDateLong } from '../../utils/date.js';
import { curriculum, STUDENT_STATUS } from '../../config/app.config.js';
import {
    reportCatalogue, reportById, run, downloadCSV, downloadSpreadsheet, printReport
} from '../../services/reports.service.js';
import { listBranches } from '../../services/settings.service.js';
import { listBatches } from '../../services/batches.service.js';

export default class ReportsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Reports';
        this.catalogue = reportCatalogue();
        this.reportId = this.query.report || null;
        this.filters = {
            from: this.query.from || startOfMonth(),
            to: this.query.to || localDate(),
            branchId: session.branch() || null,
            batchId: null,
            level: null,
            status: null
        };
        this.result = null;
        this.running = false;
        this.options = { branches: [], batches: [] };
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head">
                <div>
                    <h1 class="v3-page-title">Reports</h1>
                    <p class="v3-page-sub" data-role="subtitle">
                        ${this.catalogue.reduce((n, g) => n + g.reports.length, 0)} reports
                    </p>
                </div>
                <div class="v3-head-actions" data-role="exports"></div>
            </div>
            <div class="v3-page-body">
                <section class="v3-card" data-role="picker"></section>
                <div data-role="filters"></div>
                <section class="v3-card" data-role="result">
                    <div class="v3-empty">Choose a report to run.</div>
                </section>
            </div>
        `);

        this.bind();

        // Branch and batch lists feed the filter bar. Fetched once — they do
        // not change between reports.
        const [branches, batches] = await Promise.all([
            listBranches().catch(() => []),
            listBatches(null, { includeClosed: true }).catch(() => [])
        ]);
        if (this.disposed) return;
        this.options = { branches, batches };

        this.paint();
        if (this.reportId) await this.runReport();

        this.events.on(EVENTS.BRANCH_CHANGED, () => {
            this.filters.branchId = session.branch() || null;
            if (this.reportId) this.runReport();
        });
    }

    paint() {
        render(this.container.querySelector('[data-role="picker"]'), html`
            <div class="v3-card-head">
                <h2 class="v3-card-title">Reports</h2>
                <p class="v3-card-note">Each one declares its own columns and the filters it honours.</p>
            </div>
            <div class="v3-card-body">
                ${this.catalogue.map((group) => html`
                    <p class="v3-form-divider">${group.group}</p>
                    <div class="v3-ops">
                        ${group.reports.map((r) => html`
                            <button class="v3-pill" data-action="pick" data-id="${r.id}"
                                    title="${r.description}"
                                    aria-pressed="${this.reportId === r.id ? 'true' : 'false'}">${r.name}</button>
                        `)}
                    </div>
                `)}
            </div>
        `);

        this.paintFilters();
        this.paintExports();
    }

    /**
     * The filter bar, assembled from the chosen report's own `filters` list.
     *
     * `from`/`to` are always shown: every builder receives them, because `run()`
     * normalises them whether the report declares them or not.
     */
    paintFilters() {
        const target = this.container.querySelector('[data-role="filters"]');
        if (!this.reportId) { render(target, ''); return; }

        const spec = reportById(this.reportId);
        const wants = spec.filters || [];
        const batches = this.filters.branchId
            ? this.options.batches.filter((b) => b.branchId === this.filters.branchId)
            : this.options.batches;

        render(target, html`
            <section class="v3-filterbar">
                <div class="v3-filter-row">
                    <label class="v3-field" style="min-width:150px;">
                        <span>From</span>
                        <input class="v3-input" type="date" data-filter="from" value="${this.filters.from}">
                    </label>
                    <label class="v3-field" style="min-width:150px;">
                        <span>To</span>
                        <input class="v3-input" type="date" data-filter="to" value="${this.filters.to}">
                    </label>

                    ${wants.includes('branch') ? html`
                        <label class="v3-field" style="min-width:170px;">
                            <span>Branch</span>
                            <select class="v3-input" data-filter="branchId">
                                <option value="">All branches</option>
                                ${this.options.branches.map((b) => html`
                                    <option value="${b.id}" ${this.filters.branchId === b.id ? 'selected' : ''}>${b.name}</option>
                                `)}
                            </select>
                        </label>
                    ` : ''}

                    ${wants.includes('batch') ? html`
                        <label class="v3-field" style="min-width:170px;">
                            <span>Batch</span>
                            <select class="v3-input" data-filter="batchId">
                                <option value="">All batches</option>
                                ${batches.map((b) => html`
                                    <option value="${b.id}" ${this.filters.batchId === b.id ? 'selected' : ''}>${b.name}</option>
                                `)}
                            </select>
                        </label>
                    ` : ''}

                    ${wants.includes('level') ? html`
                        <label class="v3-field" style="min-width:170px;">
                            <span>Level</span>
                            <select class="v3-input" data-filter="level">
                                <option value="">All levels</option>
                                ${curriculum().map((l) => html`
                                    <option value="${l.value}" ${this.filters.level === l.value ? 'selected' : ''}>${l.label}</option>
                                `)}
                            </select>
                        </label>
                    ` : ''}

                    ${wants.includes('status') ? html`
                        <label class="v3-field" style="min-width:150px;">
                            <span>Status</span>
                            <select class="v3-input" data-filter="status">
                                <option value="">Any status</option>
                                ${Object.values(STUDENT_STATUS).map((s) => html`
                                    <option value="${s}" ${this.filters.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>
                                `)}
                            </select>
                        </label>
                    ` : ''}

                    <button class="v3-action-btn v3-btn-md" data-action="run" ${this.running ? 'disabled' : ''}>
                        ${this.running ? 'Running…' : 'Run'}
                    </button>
                </div>
            </section>
        `);
    }

    paintExports() {
        render(this.container.querySelector('[data-role="exports"]'), this.result ? html`
            <button class="v3-ghost-btn v3-btn-md" data-action="csv">CSV</button>
            <button class="v3-ghost-btn v3-btn-md" data-action="xls">Spreadsheet</button>
            <button class="v3-ghost-btn v3-btn-md" data-action="print">Print</button>
        ` : '');
    }

    async runReport() {
        if (!this.reportId) return;
        this.running = true;
        this.paintFilters();
        render(this.container.querySelector('[data-role="result"]'),
            html`<div class="v3-skeleton">Running…</div>`);

        try {
            this.result = await run(this.reportId, this.filters);
            if (this.disposed) return;
            this.running = false;
            this.paintFilters();
            this.paintExports();
            this.paintResult();
        } catch (err) {
            if (this.disposed) return;
            this.running = false;
            this.result = null;
            this.paintFilters();
            this.paintExports();
            render(this.container.querySelector('[data-role="result"]'), html`
                <div class="v3-empty">That report could not be run — ${err.message}</div>
            `);
        }
    }

    paintResult() {
        const r = this.result;
        const target = this.container.querySelector('[data-role="result"]');
        if (!r) { render(target, html`<div class="v3-empty">Choose a report to run.</div>`); return; }

        render(target, html`
            <div class="v3-card-head">
                <div>
                    <h2 class="v3-card-title">${r.report.name}</h2>
                    <p class="v3-card-note">
                        ${formatNumber(r.count)} row${r.count === 1 ? '' : 's'} ·
                        ${formatDateLong(r.filters.from)} to ${formatDateLong(r.filters.to)} ·
                        run by ${r.generatedBy}
                    </p>
                </div>
            </div>

            ${r.note ? html`<div class="v3-notice" data-tone="caution">${r.note}</div>` : ''}

            ${r.count ? html`
                <!-- Scrolls inside its own container; the page itself never
                     scrolls sideways. -->
                <div class="v3-table-scroll">
                    <table class="v3-table">
                        <thead>
                            <tr>${r.report.columns.map((c) => html`<th>${c.label}</th>`)}</tr>
                        </thead>
                        <tbody>
                            ${r.rows.map((row) => html`
                                <tr>
                                    ${r.report.columns.map((c) => html`<td>${cell(row, c)}</td>`)}
                                </tr>
                            `)}
                        </tbody>
                        ${r.totals ? html`
                            <tfoot>
                                <tr>
                                    ${r.report.columns.map((c) => html`
                                        <td>${r.totals[c.key] !== undefined ? cell(r.totals, c) : ''}</td>
                                    `)}
                                </tr>
                            </tfoot>
                        ` : ''}
                    </table>
                </div>
            ` : html`<div class="v3-empty">No rows matched those filters.</div>`}
        `);
    }

    bind() {
        const root = this.container;

        this.onDispose(on(root, 'click', '[data-action="pick"]', (_e, t) => {
            this.reportId = t.dataset.id;
            this.result = null;
            this.paint();
            this.paintResult();
            this.runReport();
        }));

        // Changing a filter does not re-run on its own: a report can be an
        // expensive read across several collections, and re-running on every
        // keystroke of a date field would be wasteful on a project that has
        // already hit its free-tier read quota once.
        this.onDispose(on(root, 'change', '[data-filter]', (_e, t) => {
            const key = t.dataset.filter;
            this.filters[key] = t.value || null;
            if (key === 'branchId') {
                this.filters.batchId = null;   // the batch list is branch-scoped
                this.paintFilters();
            }
        }));

        this.onDispose(on(root, 'click', '[data-action="run"]', () => this.runReport()));

        this.onDispose(on(root, 'click', '[data-action="csv"]', () => {
            try { downloadCSV(this.result); toast.success('CSV downloaded'); }
            catch (err) { toast.error(err.message); }
        }));
        this.onDispose(on(root, 'click', '[data-action="xls"]', () => {
            try { downloadSpreadsheet(this.result); toast.success('Spreadsheet downloaded'); }
            catch (err) { toast.error(err.message); }
        }));
        this.onDispose(on(root, 'click', '[data-action="print"]', async () => {
            try { await printReport(this.result); }
            catch (err) { toast.error(err.message); }
        }));
    }
}

/* ------------------------------------------------------------------ HELPERS */

/**
 * One cell, formatted by the column's own `format` when it declares one.
 *
 * The service owns formatting — a money column carries `formatMoney`, a date
 * column `formatDate` — so this never guesses from the value's type. An empty
 * value renders as an em dash rather than "undefined".
 */
function cell(row, column) {
    const raw = row[column.key];
    if (raw === null || raw === undefined || raw === '') return '—';
    return typeof column.format === 'function' ? column.format(raw, row) : String(raw);
}

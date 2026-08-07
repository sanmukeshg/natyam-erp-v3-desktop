/**
 * Natyam ERP v3 — Admin — Analytics
 *
 * One screen assembled from ten panels, each of which is a separate query
 * across a different part of the school.
 *
 * THE DESIGN CONSTRAINT THAT MATTERS: `analyticsOverview()` gathers those ten
 * with `Promise.allSettled`, not `Promise.all`, and returns a `failed` array
 * naming whichever ones threw. That is deliberate — a broken teacher-compliance
 * query should not blank the whole screen — but it only pays off if the page
 * **says which panels are missing** instead of quietly rendering nine. A
 * dashboard that silently drops a panel is worse than one that fails loudly,
 * because the reader has no way to know the picture is incomplete.
 *
 * NO CHART LIBRARY. `ui/chart.js` belongs to v2's stylesheet, which this app
 * has never loaded. Trends are drawn as proportional bars in plain markup —
 * the same `.v3-trend` pattern Finance uses. Twelve months of two figures does
 * not justify a dependency.
 *
 * NO DESIGN FILE (`Analytics.dc.html` was never generated). Reuses the KPI
 * strip, card list and two-column layout the other Phase-2 screens established.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatMoney, formatNumber } from '../../utils/money.js';
import { formatDateLong, localDate, addDays } from '../../utils/date.js';
import { analyticsOverview } from '../../services/analytics.service.js';
// UAT5 ENH-505 filters. curriculum() is the Course list — a student is placed
// at a curriculum level, and that is what 'course' means in this school.
import { curriculum } from '../../config/app.config.js';
import { listAcademicYears } from '../../services/settings.service.js';
import { listBatches } from '../../services/batches.service.js';

/*
 * UAT5 ENH-504 Part 2 — the ranges the Finance trend came here to get.
 *
 * `days` sets the SUMMARY window exactly: analyticsOverview() hands from/to
 * straight to profitAndLoss() and the comparisons. `months` is how many monthly
 * buckets the trend cards draw, and it has to be whole months because every
 * series in the service is bucketed by `period` — a thirty-day window that
 * crosses a month boundary touches two, which is why 30d asks for 2.
 *
 * Kept in step with natyam-mobile's analytics page, which offers the same five.
 */
const RANGES = [
    { key: '30d', label: '30 days', days: 30, months: 2 },
    { key: '3m', label: '3 months', months: 3 },
    { key: '6m', label: '6 months', months: 6 },
    { key: '12m', label: '12 months', months: 12 },
    { key: 'custom', label: 'Custom', custom: true }
];

export default class AnalyticsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Analytics';

        // ?months= is still honoured — Finance links here with
        // ?series=money&months=6, and older bookmarks carry it. It selects the
        // matching chip rather than living as separate state.
        const months = Number(this.query.months) || 12;
        this.range = RANGES.find((r) => r.months === months && !r.custom) || RANGES[3];
        this.custom = { from: '', to: '' };

        /*
         * UAT5 ENH-505 filters.
         *
         * `year` is a RANGE, not a dimension — an academic year record is a
         * startsOn/endsOn pair, so choosing one sets the window and reaches
         * every panel. It lives beside the range chips for that reason.
         *
         * `batchId` and `level` are the cohort, and they narrow the
         * student-shaped panels only. The service explains why the money
         * panels cannot follow (the ledger carries no batch and no level) and
         * the page says so on screen when one is active.
         */
        this.year = null;
        this.batchId = null;
        this.level = null;
        this.options = { years: [], batches: [] };
        this.data = null;
    }

    /** The chosen range, as analyticsOverview() wants it. */
    resolveRange() {
        const today = localDate();

        // An academic year IS a range — ENH-505. Capped at today, because a
        // year that runs to next March must not draw eight empty months.
        if (this.year) {
            const to = this.year.endsOn < today ? this.year.endsOn : today;
            return { months: monthsBetween(this.year.startsOn), from: this.year.startsOn, to };
        }

        if (this.range.custom) {
            const { from, to } = this.custom;
            if (!from || !to) return { months: 12 };
            return { months: monthsBetween(from), from, to };
        }

        if (this.range.days) {
            return { months: this.range.months, from: addDays(today, -(this.range.days - 1)), to: today };
        }

        return { months: this.range.months };
    }

    /** Everything the filter row needs to offer. Fetched once — it rarely changes. */
    async loadOptions() {
        const [years, batches] = await Promise.all([
            listAcademicYears().catch(() => []),
            listBatches(session.branch()).catch(() => [])
        ]);
        this.options = { years, batches: batches.filter((b) => b.status !== 'closed') };
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head v3-page-head-row">
                <div>
                    <h1 class="v3-page-title">Analytics</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading…</p>
                </div>
                <div class="v3-head-actions" data-role="ranges"></div>
            </div>
                <div class="v3-tabs" role="tablist" style="margin-top:12px;">
                    <a class="v3-tab" href="#/analytics" role="tab"
                       aria-selected="true">Insights</a>
                    <a class="v3-tab" href="#/analytics/reports" role="tab"
                       aria-selected="false">Reports</a>
                </div>
            <div class="v3-page-body" data-role="body">
                <div class="v3-skeleton">Gathering ten views of the school…</div>
            </div>
        `);

        this.bind();
        await this.loadOptions();
        await this.load();

        this.events.on(EVENTS.BRANCH_CHANGED, () => this.load());
    }

    async load() {
        try {
            this.data = await analyticsOverview({
                branchId: session.branch(),
                batchId: this.batchId,
                level: this.level,
                ...this.resolveRange()
            });
            if (this.disposed) return;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Analytics failed to load', err);
            render(this.container.querySelector('[data-role="body"]'), html`
                <div class="v3-error">Analytics could not be assembled — ${err.message}</div>
            `);
        }
    }

    paint() {
        const d = this.data;
        if (!d) return;

        /*
         * Trim the trend buckets to the window in the heading.
         *
         * The series always count BACK from today — that is how lastMonths()
         * works and it cannot be asked for a window ending in the past. So a
         * custom range of 15 May to 20 July fetched four buckets and drew an
         * August bar under a heading that stopped in July. Filtering by month
         * key is enough: a bucket survives if its month overlaps the range at
         * all, which for the fixed ranges is every one of them and changes
         * nothing.
         */
        const within = (rows) => (Array.isArray(rows)
            ? rows.filter((row) => {
                if (!row.period) return true;
                return row.period >= d.range.from.slice(0, 7) && row.period <= d.range.to.slice(0, 7);
            })
            : rows);

        render(this.container.querySelector('[data-role="subtitle"]'),
            `${formatDateLong(d.range.from)} to ${formatDateLong(d.range.to)}`);

        render(this.container.querySelector('[data-role="ranges"]'), html`
            ${RANGES.map((r) => html`
                <button class="v3-pill" data-action="range" data-key="${r.key}"
                        aria-pressed="${this.range.key === r.key && !this.year ? 'true' : 'false'}">${r.label}</button>
            `)}
            ${this.range.custom && !this.year ? html`
                <input class="v3-branch-select" type="date" data-role="from" value="${this.custom.from}"
                       max="${localDate()}" aria-label="From">
                <input class="v3-branch-select" type="date" data-role="to" value="${this.custom.to}"
                       max="${localDate()}" aria-label="To">
            ` : ''}

            <!--
                UAT5 ENH-505 — the three remaining filters.

                Academic year sits with the ranges because that is what it is;
                picking one deselects the chips above and drives the same
                from/to. Batch and Course are the cohort and sit after it.
            -->
            ${this.options.years.length ? html`
                <select class="v3-branch-select" data-role="year" aria-label="Academic year">
                    <option value="">Any academic year</option>
                    ${this.options.years.map((y) => html`
                        <option value="${y.id}" ${this.year?.id === y.id ? 'selected' : ''}>${y.name || y.label || y.id}</option>
                    `)}
                </select>
            ` : ''}

            <select class="v3-branch-select" data-role="level" aria-label="Course">
                <option value="">Any course</option>
                ${curriculum().map((l) => html`
                    <option value="${l.value}" ${this.level === l.value ? 'selected' : ''}>${l.label}</option>
                `)}
            </select>

            <select class="v3-branch-select" data-role="batch" aria-label="Batch">
                <option value="">Any batch</option>
                ${this.options.batches.map((b) => html`
                    <option value="${b.id}" ${this.batchId === b.id ? 'selected' : ''}>${b.name}</option>
                `)}
            </select>
        `);

        render(this.container.querySelector('[data-role="body"]'), html`
            <!--
                Named, not swallowed. analyticsOverview() uses allSettled so one
                failing query cannot blank the screen — but a reader must be told
                the picture is incomplete, or they will draw conclusions from a
                dashboard that is quietly missing a panel.
            -->
            ${d.failed?.length ? html`
                <div class="v3-notice" data-tone="caution">
                    <strong>${d.failed.length} panel${d.failed.length === 1 ? '' : 's'} could not be built:</strong>
                    ${d.failed.join(', ')}. Everything else on this page is complete —
                    but read it knowing those are absent.
                </div>
            ` : ''}

            <!--
                UAT5 ENH-505 — what the cohort filter does NOT reach.

                Said out loud, above the figures, because the alternative is a
                page that lies by omission: "Kondapur Senior Batch" in the
                filter bar over ₹26,500 of Utilities, and a reader would be
                right to think one class spent it. The ledger carries a branch
                and nothing finer — see resolveCohort() in analytics.service.
            -->
            ${d.cohort ? html`
                <div class="v3-notice" data-tone="info">
                    <strong>Filtered to ${d.cohort.size} student${d.cohort.size === 1 ? '' : 's'}.</strong>
                    Students, attendance, batches and admissions follow that filter.
                    ${d.cohort.moneyIsSchoolWide
                        ? 'Income, expenses and the category splits are school-wide — money is recorded against a branch, never a batch or a course.'
                        : ''}
                </div>
            ` : ''}

            ${d.kpis ? html`
                <div class="v3-kpis">
                    ${Object.values(d.kpis).map((k) => kpiCard(k))}
                </div>
            ` : ''}

            <!--
                UAT5 ENH-505 — the insights, above the charts that support them.

                Deliberately first. The ticket's complaint is that the data is
                all here and none of it is usable; a sentence saying "Utilities
                is 49% of everything you spend" is the usable form, and the
                charts below are where someone goes to check it. Every one is
                derived from panels already fetched, so this section costs no
                extra query — see businessInsights().
            -->
            ${d.insights?.length ? html`
                <section class="v3-card">
                    <div class="v3-card-head"><h2 class="v3-card-title">What this says</h2></div>
                    <div class="v3-list">
                        ${d.insights.map((insight) => html`
                            <div class="v3-row">
                                <span class="v3-dot" data-severity="${
                                    insight.tone === 'caution' ? 'medium' : insight.tone === 'positive' ? 'low' : ''
                                }"></span>
                                <div class="v3-row-main">
                                    <div class="v3-row-title">${insight.title}</div>
                                    <div class="v3-row-detail">${insight.detail}</div>
                                </div>
                                <a class="v3-ghost-btn" href="${insight.link}">Open</a>
                            </div>
                        `)}
                    </div>
                </section>
            ` : ''}

            <div class="v3-two-col">
                ${mixCard('Income by category', d.incomeMix)}
                ${mixCard('Expenses by category', d.expenseMix)}
            </div>

            <div class="v3-two-col">
                ${meterCard('Students by batch', (d.batches?.rows || []).map((b) => ({
                    label: b.label,
                    value: b.value,
                    note: `${b.value}${b.capacity ? ` of ${b.capacity}` : ''}`,
                    caution: b.key === 'unplaced'
                })))}
                ${trendCard('Admissions by month', d.admissionsMonthly,
                            (m) => Math.max(m.applied ?? 0, m.enrolled ?? 0),
                            (m) => `${m.applied} applied · ${m.enrolled} enrolled`, {
                                note: 'Applied against enrolled, dated by when the family applied.',
                                barsOf: (m) => [
                                    { tone: 'positive', value: m.applied ?? 0, title: `${m.applied} applied` },
                                    { tone: 'negative', value: m.enrolled ?? 0, title: `${m.enrolled} enrolled` }
                                ]
                            })}
            </div>

            <!--
                UAT5 ENH-504 Part 2 — Money in against money out, the Finance
                page's old "Last six months" block, now over any range. Two bars
                on one scale, the chip carrying the month's net. It leads the
                trends because it is the reason a Finance link points here.
            -->
            ${trendCard('Money in and out', within(d.revenue),
                        (m) => Math.max(m.income ?? 0, m.expense ?? 0),
                        (m) => formatMoney(m.net ?? 0), {
                            note: 'Money in above, money out below, on one scale. The chip is the month’s net.',
                            barsOf: (m) => [
                                { tone: 'positive', value: m.income ?? 0, title: `In ${formatMoney(m.income ?? 0)}` },
                                { tone: 'negative', value: m.expense ?? 0, title: `Out ${formatMoney(m.expense ?? 0)}` }
                            ],
                            toneOf: (m) => ((m.net ?? 0) >= 0 ? 'clear' : 'overdue')
                        })}

            <div class="v3-two-col">
                ${trendCard('Students on the roll', within(d.growth), (m) => m.total ?? m.closing ?? 0,
                            (m) => formatNumber(m.total ?? m.closing ?? 0))}
                ${trendCard('Income', within(d.revenue), (m) => m.income ?? m.value ?? 0,
                            (m) => formatMoney(m.income ?? m.value ?? 0))}
            </div>

            <div class="v3-two-col">
                ${trendCard('Attendance', within(d.attendance), (m) => m.rate ?? 0,
                            (m) => (m.rate === null || m.rate === undefined ? '—' : `${m.rate}%`))}
                ${trendCard('Collected', within(d.collection), (m) => m.collected ?? 0,
                            (m) => formatMoney(m.collected ?? 0))}
            </div>

            ${listCard('Branches', d.branches, (b) => ({
                title: b.name || b.branchName || '—',
                meta: `${formatNumber(b.students ?? 0)} students · ${formatMoney(b.income ?? 0)} income`,
                chip: formatMoney(b.net ?? 0),
                tone: (b.net ?? 0) >= 0 ? 'clear' : 'overdue'
            }))}

            ${listCard('Teachers', d.teachers, (t) => ({
                title: t.name || t.staffName || '—',
                meta: `${formatNumber(t.batches ?? t.batchCount ?? 0)} batches · `
                    + `${t.compliance ?? t.markedRate ?? '—'}% of registers marked`,
                chip: t.attendanceRate === null || t.attendanceRate === undefined
                    ? '—' : `${t.attendanceRate}%`,
                tone: (t.attendanceRate ?? 0) >= 75 ? 'clear' : 'overdue'
            }))}

            ${d.funnel ? html`
                <section class="v3-card">
                    <div class="v3-card-head"><h2 class="v3-card-title">Admissions funnel</h2></div>
                    <div class="v3-ops">
                        ${(Array.isArray(d.funnel) ? d.funnel : d.funnel.stages || []).map((s) => html`
                            <span class="v3-chip">${s.label || s.status} · ${formatNumber(s.count ?? 0)}</span>
                        `)}
                    </div>
                </section>
            ` : ''}
        `);

        this.scrollTrendsToLatest();
    }

    /**
     * Start every capped trend list at its NEWEST end.
     *
     * The lists are chronological — a trend has to read in time order — so the
     * months worth seeing are the last ones. Capping the height alone would
     * have parked the view on the oldest four, which for this school is four
     * months of zeroes with the only real figures scrolled out of sight.
     *
     * Done here rather than by reversing the data, because reversing would put
     * the trend backwards and every bar chart on the page reads left-to-right
     * in time. The scroll bar still goes up for anyone wanting the history.
     */
    scrollTrendsToLatest() {
        this.container.querySelectorAll('[data-role="trend-list"]').forEach((list) => {
            list.scrollTop = list.scrollHeight;
        });
    }

    bind() {
        // UAT5 ENH-505 — the three filters. Each reloads; none is a repaint,
        // because every one of them changes what the service is asked for.
        const rebuild = () => {
            render(this.container.querySelector('[data-role="body"]'),
                html`<div class="v3-skeleton">Rebuilding…</div>`);
            this.load();
        };

        this.onDispose(on(this.container, 'change', '[data-role="year"]', (_e, t) => {
            this.year = this.options.years.find((y) => y.id === t.value) || null;
            rebuild();
        }));
        this.onDispose(on(this.container, 'change', '[data-role="level"]', (_e, t) => {
            this.level = t.value || null;
            rebuild();
        }));
        this.onDispose(on(this.container, 'change', '[data-role="batch"]', (_e, t) => {
            this.batchId = t.value || null;
            rebuild();
        }));

        this.onDispose(on(this.container, 'click', '[data-action="range"]', (_e, t) => {
            const next = RANGES.find((r) => r.key === t.dataset.key);
            if (!next || (next.key === this.range.key && !this.year)) return;
            // Choosing a range chip clears an academic year — they are two
            // ways of saying the same thing and must not both be lit.
            this.year = null;
            this.range = next;

            // Opening the custom pickers queries nothing — there is no window
            // yet. Repaint so the two date fields appear.
            if (next.custom && !(this.custom.from && this.custom.to)) { this.paint(); return; }

            render(this.container.querySelector('[data-role="body"]'),
                html`<div class="v3-skeleton">Rebuilding…</div>`);
            this.load();
        }));

        // Only queried once both ends are set: a half-open window would report
        // the last twelve months under a heading that says otherwise.
        this.onDispose(on(this.container, 'change', '[data-role="from"], [data-role="to"]', (_e, t) => {
            this.custom[t.dataset.role] = t.value;
            if (!(this.custom.from && this.custom.to)) return;
            if (this.custom.from > this.custom.to) {
                toast.error('Check the dates', 'The start of the range is after its end.');
                return;
            }
            render(this.container.querySelector('[data-role="body"]'),
                html`<div class="v3-skeleton">Rebuilding…</div>`);
            this.load();
        }));
    }
}

/* ------------------------------------------------------------------ HELPERS */

/**
 * How many monthly buckets a custom window touches.
 *
 * The trend series count BACK from today, so a window ending in the past needs
 * enough buckets to reach it — which is why this measures from the start of the
 * range to now rather than to the range's own end. Capped at ten years so a
 * mistyped year costs one odd chart, not a hundred and twenty queries.
 */
function monthsBetween(from) {
    const start = new Date(`${from}T00:00:00`);
    const now = new Date();
    const span = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
    return Math.min(120, Math.max(1, span));
}

/** Renders one `kpi()` record from analytics.service — value, delta, direction. */
function kpiCard(k) {
    if (!k) return '';
    const value = k.format === 'money' ? formatMoney(k.value || 0)
        : k.format === 'percent' ? (k.value === null ? '—' : `${k.value}%`)
        : formatNumber(k.value || 0);

    // `good` is the service's own judgement — it already knows that a rising
    // outstanding balance is bad while rising income is good, so the colour is
    // not re-derived from the sign here.
    const tone = k.good === null || k.good === undefined ? 'neutral' : (k.good ? 'positive' : 'negative');

    const delta = k.delta === null || k.delta === undefined ? null
        : k.format === 'money' ? formatMoney(Math.abs(k.delta))
        : k.format === 'percent' ? `${Math.abs(k.delta)}%`
        : formatNumber(Math.abs(k.delta));

    const arrow = k.direction === 'up' ? '↑' : k.direction === 'down' ? '↓' : '→';

    return html`
        <div class="v3-kpi" data-tone="${tone}">
            <div style="flex:1;min-width:0;">
                <div class="v3-kpi-label">${k.label}</div>
                <div class="v3-kpi-value">${value}</div>
                ${delta !== null ? html`
                    <div class="v3-kpi-delta" data-tone="${tone}">
                        ${arrow} ${delta} on last month
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * A month-by-month bar list.
 *
 * Tolerant of shape by design: the five trend series come from five different
 * services and do not agree on their field names (`total` vs `closing`,
 * `income` vs `value`). Rather than five near-identical renderers, the caller
 * passes an accessor — and a series that arrives null (its panel failed) is
 * skipped here rather than crashing the page.
 */
function trendCard(title, series, valueOf, labelOf, { note = null, barsOf = null, toneOf = null } = {}) {
    if (!Array.isArray(series) || !series.length) {
        return html`
            <section class="v3-card">
                <div class="v3-card-head"><h2 class="v3-card-title">${title}</h2></div>
                <div class="v3-empty">Not available.</div>
            </section>
        `;
    }

    // `valueOf` still sets the scale even when `barsOf` draws the bars — for
    // the money card it returns the larger of in and out, so both bars share
    // one axis and the taller month is visibly the taller month.
    const peak = Math.max(1, ...series.map((m) => Math.abs(valueOf(m) || 0)));

    return html`
        <section class="v3-card">
            <div class="v3-card-head">
                <h2 class="v3-card-title">${title}</h2>
                ${note ? html`<p class="v3-card-note">${note}</p>` : ''}
            </div>
            <!--
                Four months tall, the rest behind a scroll — asked for directly.

                Twelve months of rows ran to 841px and stacked six such cards
                into a page nobody scrolled to the bottom of. Worse, most of
                those rows read "0 applied · 0 enrolled": a school in its second
                year has empty history, and printing it at full height buried
                the one month that had anything in it.

                SCROLLED TO THE END, NOT THE START — see scrollTrendsToLatest().
                These lists are chronological because a trend has to read in
                time order, so the useful months are at the BOTTOM. A plain
                height cap would have shown four empty 2025 months and hidden
                August 2026 entirely, which is worse than the long list it
                replaced.
            -->
            <div class="v3-list v3-trend-cap" data-role="trend-list">
                ${series.map((m) => html`
                    <div class="v3-row">
                        <div class="v3-row-main">
                            <div class="v3-row-title">${m.label || m.period || m.month}</div>
                            <div class="v3-trend">
                                ${(barsOf
                                    ? barsOf(m)
                                    : [{ tone: 'positive', value: Math.abs(valueOf(m) || 0), title: null }]
                                ).map((bar) => html`
                                    <span class="v3-trend-bar" data-tone="${bar.tone}"
                                          style="width:${Math.round((Math.abs(bar.value || 0) / peak) * 100)}%"
                                          title="${bar.title || ''}"></span>
                                `)}
                            </div>
                        </div>
                        <span class="v3-chip" data-fee="${toneOf ? toneOf(m) : ''}">${labelOf(m)}</span>
                    </div>
                `)}
            </div>
        </section>
    `;
}

/**
 * A category split — UAT5 ENH-505's two pies.
 *
 * A ranked list with proportion bars rather than an actual pie. On a desktop
 * card the legend IS the chart: six labelled rows with amounts and percentages
 * answer "what and how much" outright, where a circle answers it only after the
 * reader matches a colour to a key. The bar carries the shape a pie was for.
 *
 * Top five and a remainder, because a category worth 2% is a sliver nobody can
 * point at and a fourteen-row legend is the long list this ticket removes.
 */
function mixCard(title, mix) {
    const rows = mix?.categories || [];
    if (!rows.length) {
        return html`
            <section class="v3-card">
                <div class="v3-card-head"><h2 class="v3-card-title">${title}</h2></div>
                <div class="v3-empty">Nothing in this range.</div>
            </section>
        `;
    }

    const top = rows.slice(0, 5);
    const rest = rows.slice(5);
    const other = rest.reduce((sum, r) => sum + r.amount, 0);

    return html`
        <section class="v3-card">
            <div class="v3-card-head">
                <h2 class="v3-card-title">${title}</h2>
                <p class="v3-card-note">${formatMoney(mix.total)} across ${rows.length} categor${rows.length === 1 ? 'y' : 'ies'}</p>
            </div>
            <div class="v3-card-body">
                ${top.map((row) => html`
                    <div class="v3-meter">
                        <div class="v3-meter-head">
                            <span>${row.category}</span>
                            <span>${formatMoney(row.amount)} · ${row.share}%</span>
                        </div>
                        <div class="v3-meter-track">
                            <div class="v3-meter-fill" style="width:${row.share}%;"></div>
                        </div>
                    </div>
                `)}
                ${other ? html`
                    <div class="v3-row-detail" style="margin-top:10px;">
                        ${rest.length} smaller categor${rest.length === 1 ? 'y' : 'ies'} — ${formatMoney(other)}.
                    </div>
                ` : ''}
            </div>
        </section>
    `;
}

/** A ranked meter list — batch sizes, and anything else shaped like them. */
function meterCard(title, rows) {
    if (!rows?.length) {
        return html`
            <section class="v3-card">
                <div class="v3-card-head"><h2 class="v3-card-title">${title}</h2></div>
                <div class="v3-empty">Not available.</div>
            </section>
        `;
    }

    const peak = Math.max(1, ...rows.map((r) => r.value || 0));

    return html`
        <section class="v3-card">
            <div class="v3-card-head"><h2 class="v3-card-title">${title}</h2></div>
            <div class="v3-card-body v3-scroll-cap">
                ${rows.map((row) => html`
                    <div class="v3-meter">
                        <div class="v3-meter-head">
                            <span>${row.label}</span>
                            <span>${row.note ?? row.value}</span>
                        </div>
                        <div class="v3-meter-track">
                            <!-- Students in no batch are a problem, not a class. -->
                            <div class="v3-meter-fill"
                                 style="width:${Math.round(((row.value || 0) / peak) * 100)}%;${
                                     row.caution ? 'background:var(--v3-caution);' : ''
                                 }"></div>
                        </div>
                    </div>
                `)}
            </div>
        </section>
    `;
}

function listCard(title, rows, mapper) {
    if (!Array.isArray(rows) || !rows.length) {
        return html`
            <section class="v3-card">
                <div class="v3-card-head"><h2 class="v3-card-title">${title}</h2></div>
                <div class="v3-empty">Not available.</div>
            </section>
        `;
    }

    return html`
        <section class="v3-card">
            <div class="v3-card-head"><h2 class="v3-card-title">${title}</h2></div>
            <div class="v3-roll">
                ${rows.map((row) => {
                    const r = mapper(row);
                    return html`
                        <div class="v3-roll-row" data-static>
                            <span class="v3-roll-main">
                                <span class="v3-roll-name">${r.title}</span>
                                <span class="v3-roll-meta">${r.meta}</span>
                            </span>
                            <span class="v3-chip" data-fee="${r.tone || ''}">${r.chip}</span>
                        </div>
                    `;
                })}
            </div>
        </section>
    `;
}

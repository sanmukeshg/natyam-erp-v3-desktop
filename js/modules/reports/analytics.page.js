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
import { formatDateLong } from '../../utils/date.js';
import { analyticsOverview } from '../../services/analytics.service.js';

const RANGES = [
    { months: 6, label: '6 months' },
    { months: 12, label: '12 months' },
    { months: 24, label: '24 months' }
];

export default class AnalyticsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Analytics';
        this.months = Number(this.query.months) || 12;
        this.data = null;
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head">
                <div>
                    <h1 class="v3-page-title">Analytics</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading…</p>
                </div>
                <div class="v3-head-actions" data-role="ranges"></div>
            </div>
            <div class="v3-page-body" data-role="body">
                <div class="v3-skeleton">Gathering ten views of the school…</div>
            </div>
        `);

        this.bind();
        await this.load();

        this.events.on(EVENTS.BRANCH_CHANGED, () => this.load());
    }

    async load() {
        try {
            this.data = await analyticsOverview({ branchId: session.branch(), months: this.months });
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

        render(this.container.querySelector('[data-role="subtitle"]'),
            `${formatDateLong(d.range.from)} to ${formatDateLong(d.range.to)}`);

        render(this.container.querySelector('[data-role="ranges"]'), html`
            ${RANGES.map((r) => html`
                <button class="v3-pill" data-action="range" data-months="${r.months}"
                        aria-pressed="${this.months === r.months ? 'true' : 'false'}">${r.label}</button>
            `)}
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
                    <strong>${d.failed.length} of 10 panels could not be built:</strong>
                    ${d.failed.join(', ')}. Everything else on this page is complete —
                    but read it knowing those are absent.
                </div>
            ` : ''}

            ${d.kpis ? html`
                <div class="v3-kpis">
                    ${Object.values(d.kpis).map((k) => kpiCard(k))}
                </div>
            ` : ''}

            <div class="v3-two-col">
                ${trendCard('Students on the roll', d.growth, (m) => m.total ?? m.closing ?? 0,
                            (m) => formatNumber(m.total ?? m.closing ?? 0))}
                ${trendCard('Income', d.revenue, (m) => m.income ?? m.value ?? 0,
                            (m) => formatMoney(m.income ?? m.value ?? 0))}
            </div>

            <div class="v3-two-col">
                ${trendCard('Attendance', d.attendance, (m) => m.rate ?? 0,
                            (m) => (m.rate === null || m.rate === undefined ? '—' : `${m.rate}%`))}
                ${trendCard('Collected', d.collection, (m) => m.collected ?? 0,
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
    }

    bind() {
        this.onDispose(on(this.container, 'click', '[data-action="range"]', (_e, t) => {
            const months = Number(t.dataset.months);
            if (months === this.months) return;
            this.months = months;
            render(this.container.querySelector('[data-role="body"]'),
                html`<div class="v3-skeleton">Rebuilding…</div>`);
            this.load();
        }));
    }
}

/* ------------------------------------------------------------------ HELPERS */

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
function trendCard(title, series, valueOf, labelOf) {
    if (!Array.isArray(series) || !series.length) {
        return html`
            <section class="v3-card">
                <div class="v3-card-head"><h2 class="v3-card-title">${title}</h2></div>
                <div class="v3-empty">Not available.</div>
            </section>
        `;
    }

    const peak = Math.max(1, ...series.map((m) => Math.abs(valueOf(m) || 0)));

    return html`
        <section class="v3-card">
            <div class="v3-card-head"><h2 class="v3-card-title">${title}</h2></div>
            <div class="v3-list">
                ${series.map((m) => html`
                    <div class="v3-row">
                        <div class="v3-row-main">
                            <div class="v3-row-title">${m.label || m.period || m.month}</div>
                            <div class="v3-trend">
                                <span class="v3-trend-bar" data-tone="positive"
                                      style="width:${Math.round((Math.abs(valueOf(m) || 0) / peak) * 100)}%"></span>
                            </div>
                        </div>
                        <span class="v3-chip">${labelOf(m)}</span>
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

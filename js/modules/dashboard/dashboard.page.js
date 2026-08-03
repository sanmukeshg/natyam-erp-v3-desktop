/**
 * Natyam ERP v3 — Admin — Dashboard
 *
 * Rebuilt for v3 from the approved design ("Dashboard.dc.html", desktop
 * half). The layout is the design's: a KPI strip, then "Needs attention"
 * beside "Today", then "Money" beside "The roll", then "Recent activity".
 *
 * What did NOT change is the rule this page was already built on: **it
 * computes nothing.** Every figure arrives from dashboard.service.js, and
 * the page's only job is to decide what a number should look like. That
 * separation is why v1's "zero pending admissions" bug cannot recur — there
 * is exactly one place a count can come from, and it is not this file.
 * dashboard.service.js is carried over from the reference project byte for
 * byte; only this view layer is new.
 *
 * The design also draws a teacher-mode variant of this screen. It is
 * deliberately not implemented here: natyam-admin turns Teacher & Reception
 * away at sign-in (they are mobile-primary), so the only roles that reach
 * this page are Administrator, Owner & Accountant and Viewer — all of whom
 * get the full view. The teacher variant belongs to natyam-mobile, and
 * dashboard.service.js's forTeacher() is left for it.
 *
 * Panels are failure-isolated by the service: one that fails arrives as
 * `{ error }`, and is rendered as an inline message in its own card rather
 * than blanking the screen.
 */

import { Page } from '../../core/router.js';
import { html, render, raw } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { levelLabel } from '../../config/app.config.js';
import { formatMoney, formatMoneyShort, formatNumber } from '../../utils/money.js';
import { formatDateLong } from '../../utils/date.js';
import { overview } from '../../services/dashboard.service.js';

const STATE_LABEL = {
    marked: 'Register marked',
    running: 'In progress',
    missed: 'Not marked',
    upcoming: 'Later today'
};

export default class DashboardPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Dashboard';
        this.data = null;
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head">
                <h1 class="v3-page-title">${greeting()}</h1>
                <p class="v3-page-sub">${formatDateLong(new Date())}</p>
            </div>
            <div class="v3-page-body" data-role="body">
                <div class="v3-skeleton">Loading the school’s figures…</div>
            </div>
        `);

        await this.load();

        // The dashboard is a read-only aggregate, so anything that changes
        // the underlying numbers should refresh it rather than leave a stale
        // figure on screen. Reloading is cheap relative to being wrong.
        [EVENTS.BRANCH_CHANGED, EVENTS.PAYMENT_RECORDED, EVENTS.ATTENDANCE_SAVED,
         EVENTS.ADMISSION_ENROLLED, EVENTS.STUDENT_CREATED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    async load() {
        const body = this.container?.querySelector('[data-role="body"]');
        if (!body) return;

        try {
            const data = await overview({ branchId: session.branch() });
            if (this.disposed) return;          // user navigated away mid-query
            this.data = data;
            render(body, this.view(data));
        } catch (err) {
            if (this.disposed) return;
            console.error('Dashboard failed to load', err);
            render(body, html`
                <div class="v3-error">
                    The dashboard could not be loaded — ${err.message}
                </div>
            `);
        }
    }

    /* ------------------------------------------------------------------ VIEW */

    view(data) {
        return html`
            ${this.kpis(data.headline)}
            <div class="v3-grid-2-1">
                ${this.attention(data.attention)}
                ${this.today(data.today)}
            </div>
            <div class="v3-grid-2-1">
                ${this.money(data.money)}
                ${this.roll(data.roll)}
            </div>
            ${this.activity(data.activity)}
        `;
    }

    /* ------------------------------------------------------------------ KPIs */

    kpis(headline) {
        if (panelFailed(headline)) return errorCard('Key figures', headline.error);
        if (!headline?.length) return '';

        return html`
            <div class="v3-kpis">
                ${headline.map((kpi) => html`
                    <a class="v3-kpi v3-card-hover" data-tone="${kpi.tone || 'neutral'}" href="${kpi.link || '#/'}">
                        <div style="flex:1;min-width:0;">
                            <div class="v3-kpi-label">${kpi.label}</div>
                            <div class="v3-kpi-value">${kpiValue(kpi)}</div>
                            ${kpi.delta ? html`
                                <div class="v3-kpi-delta" data-tone="${kpi.delta.tone || 'neutral'}">
                                    ${kpi.delta.value}${kpi.delta.note ? ` ${kpi.delta.note}` : ''}
                                </div>
                            ` : ''}
                        </div>
                    </a>
                `)}
            </div>
        `;
    }

    /* ------------------------------------------------------- NEEDS ATTENTION */

    attention(items) {
        if (panelFailed(items)) return errorCard('Needs attention', items.error);

        return html`
            <section class="v3-card v3-card-hover">
                <div class="v3-card-head"><h2 class="v3-card-title">Needs attention</h2></div>
                ${items?.length ? html`
                    <div class="v3-list">
                        ${items.map((item) => html`
                            <div class="v3-row">
                                <span class="v3-dot" data-severity="${item.severity}"></span>
                                <div class="v3-row-main">
                                    <div class="v3-row-title">${item.title}</div>
                                    <div class="v3-row-detail">${item.detail}</div>
                                </div>
                                <a class="v3-ghost-btn" href="${item.link}">${item.action}</a>
                            </div>
                        `)}
                    </div>
                ` : html`<div class="v3-empty">Nothing needs attention. Everything is up to date.</div>`}
            </section>
        `;
    }

    /* ----------------------------------------------------------------- TODAY */

    today(today) {
        if (panelFailed(today)) return errorCard('Today', today.error);

        if (today?.holiday) {
            return html`
                <section class="v3-card v3-card-hover">
                    <div class="v3-card-head"><h2 class="v3-card-title">Today</h2></div>
                    <div class="v3-empty">
                        ${today.holiday.name || 'Holiday'} — no classes are scheduled.
                    </div>
                </section>
            `;
        }

        const classes = today?.classes || [];

        return html`
            <section class="v3-card v3-card-hover">
                <div class="v3-card-head">
                    <h2 class="v3-card-title">Today</h2>
                    <p class="v3-card-note">${today?.registersDone ?? 0} of ${today?.total ?? 0} registers marked</p>
                </div>
                ${classes.length ? html`
                    <div class="v3-scroll-cap" style="padding:8px;">
                        ${classes.map((cls) => html`
                            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px;">
                                <div style="min-width:0;">
                                    <div class="v3-row-title">${cls.name}</div>
                                    <div class="v3-row-detail">
                                        ${cls.startTime}–${cls.endTime}${cls.teacher ? ` · ${cls.teacher}` : ''}
                                    </div>
                                </div>
                                <span class="v3-badge" data-state="${cls.state}">
                                    ${cls.done && cls.rate !== null ? `${cls.rate}% present` : STATE_LABEL[cls.state]}
                                </span>
                            </div>
                        `)}
                    </div>
                ` : html`<div class="v3-empty">No classes are scheduled today.</div>`}
            </section>
        `;
    }

    /* ----------------------------------------------------------------- MONEY */

    money(money) {
        if (panelFailed(money)) return errorCard('Money', money.error);

        const series = money?.series || [];
        const peak = Math.max(1, ...series.map((row) => row.income || 0));

        return html`
            <section class="v3-card v3-card-hover">
                <div class="v3-card-head"><h2 class="v3-card-title">Money</h2></div>
                <div class="v3-card-body">
                    <div class="v3-stat-row">
                        <div>
                            <div class="v3-stat-label">Collected this month</div>
                            <div class="v3-stat-value">${formatMoney(money?.collectedThisMonth || 0)}</div>
                        </div>
                        <div>
                            <div class="v3-stat-label">Outstanding</div>
                            <div class="v3-stat-value">${formatMoney(money?.outstanding || 0)}</div>
                        </div>
                        <div>
                            <div class="v3-stat-label">Net position</div>
                            <div class="v3-stat-value">${formatMoney(money?.position?.net || 0)}</div>
                        </div>
                    </div>

                    ${series.length ? html`
                        <div class="v3-rule"></div>
                        <div class="v3-bars">
                            ${series.map((row) => html`
                                <div class="v3-bar-col">
                                    <div class="v3-bar-value">${formatMoneyShort(row.income || 0)}</div>
                                    <div class="v3-bar" style="height:${Math.round(((row.income || 0) / peak) * 110) + 10}px;"></div>
                                    <div class="v3-bar-label">${row.label}</div>
                                </div>
                            `)}
                        </div>
                    ` : ''}
                </div>
            </section>
        `;
    }

    /* ------------------------------------------------------------------ ROLL */

    roll(roll) {
        if (panelFailed(roll)) return errorCard('The roll', roll.error);

        // The design shows three grouped bars because its sample data had
        // three levels. The real ladder has thirteen, so this renders the
        // levels the school actually has students in, largest first — the
        // design's meter pattern, honest to the data behind it.
        const levels = [...(roll?.byLevel || [])]
            .filter((row) => row.count > 0)
            .sort((a, b) => b.count - a.count);
        const peak = Math.max(1, ...levels.map((row) => row.count));

        return html`
            <section class="v3-card v3-card-hover">
                <div class="v3-card-head">
                    <h2 class="v3-card-title">The roll</h2>
                    <p class="v3-card-note">
                        ${formatNumber(roll?.total || 0)} active students${
                            roll?.capacity?.occupancy !== null && roll?.capacity?.occupancy !== undefined
                                ? ` · ${roll.capacity.occupancy}% of seats filled` : ''}
                    </p>
                </div>
                ${levels.length ? html`
                    <div class="v3-card-body v3-scroll-cap">
                        ${levels.map((row) => html`
                            <div class="v3-meter">
                                <div class="v3-meter-head">
                                    <span>${levelLabel(row.key, 'Unassigned level')}</span>
                                    <span>${row.count}</span>
                                </div>
                                <div class="v3-meter-track">
                                    <div class="v3-meter-fill" style="width:${Math.round((row.count / peak) * 100)}%;"></div>
                                </div>
                            </div>
                        `)}
                        ${roll?.unplaced ? html`
                            <div class="v3-row-detail" style="margin-top:12px;">
                                ${roll.unplaced} student${roll.unplaced === 1 ? ' is' : 's are'} not in a batch yet.
                            </div>
                        ` : ''}
                    </div>
                ` : html`<div class="v3-empty">No active students on the roll yet.</div>`}
            </section>
        `;
    }

    /* -------------------------------------------------------------- ACTIVITY */

    activity(rows) {
        if (panelFailed(rows)) return errorCard('Recent activity', rows.error);

        return html`
            <section class="v3-card v3-card-hover">
                <div class="v3-card-head"><h2 class="v3-card-title">Recent activity</h2></div>
                ${rows?.length ? html`
                    <div class="v3-list">
                        ${rows.map((entry) => html`
                            <div class="v3-row">
                                <span class="v3-dot"></span>
                                <div class="v3-row-main">
                                    <div class="v3-row-detail" style="color:var(--v3-name);font-size:var(--text-sm);">
                                        ${entry.summary}
                                    </div>
                                    <div class="v3-row-detail">${entry.ago}</div>
                                </div>
                            </div>
                        `)}
                    </div>
                ` : html`<div class="v3-empty">Nothing has happened yet today.</div>`}
            </section>
        `;
    }
}

/* ------------------------------------------------------------------ HELPERS */

/** A panel the service failure-isolated into `{ error }` rather than data. */
function panelFailed(panel) {
    return Boolean(panel && !Array.isArray(panel) && panel.error);
}

function errorCard(title, message) {
    return html`
        <section class="v3-card">
            <div class="v3-card-head"><h2 class="v3-card-title">${title}</h2></div>
            <div class="v3-empty">${message || 'This panel could not be loaded.'}</div>
        </section>
    `;
}

function kpiValue(kpi) {
    if (kpi.money) return formatMoney(kpi.value || 0);
    if (typeof kpi.value === 'number') return `${formatNumber(kpi.value)}${kpi.unit || ''}`;
    return `${kpi.value ?? '—'}${kpi.unit || ''}`;
}

function greeting() {
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const first = (session.actorName() || '').trim().split(/\s+/)[0];
    return first ? `${part}, ${first}` : part;
}

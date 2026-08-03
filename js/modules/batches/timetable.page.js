/**
 * Natyam ERP v3 — Admin — Timetable
 *
 * The week: which classes run on which day, and whether each register has
 * been taken. This is also **Attendance's front door** — clicking a tile is
 * how a person reaches the register, which is why Attendance can now go back
 * to being hidden from the sidebar (see js/config/navigation.js).
 *
 * NO APPROVED v3 DESIGN FILE EXISTS FOR THIS SCREEN — `Timetable.dc.html` was
 * lost with the design project (see docs/design/README.md). One piece of it
 * survived, though, in the project's own change log, and is honoured here:
 *
 *   > "Timetable: weekly-grid tiles (desktop) and agenda cards (mobile) now
 *   >  show only the batch name and time slot — dropped the stacked
 *   >  curriculum levels / teacher / room line, matching v2.25.0's tile
 *   >  simplification"
 *
 * So a tile carries the batch name and its time, and nothing else. The
 * teacher and level are still available — they are on the tile's `title`
 * tooltip and in the day agenda — but they no longer crowd the grid, which
 * is the whole point of a grid.
 *
 * Everything else is the implemented v3 system, and the data is entirely
 * `timetable()` from batches.service.js, carried over unmodified — including
 * the awkward parts it already handles: replacement sessions landing on a day
 * the batch does not normally meet, and postponed originals being filtered
 * out so only the replacement's date shows anything.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { session } from '../../core/session.js';
import { router } from '../../core/router.js';
import { EVENTS } from '../../core/bus.js';
import { startOfWeek, addDays, localDate, formatDate } from '../../utils/date.js';
import { timetable } from '../../services/batches.service.js';
import { markingWindow } from '../../services/attendance.service.js';

export default class TimetablePage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Timetable';
        this.weekStart = this.query.week || startOfWeek();
        this.days = [];
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head v3-page-head-row">
                <div>
                    <h1 class="v3-page-title">Timetable</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading the week…</p>
                </div>
                <div class="v3-head-actions">
                    <button class="v3-ghost-btn v3-btn-md" data-action="week" data-delta="-7"
                            aria-label="Previous week">${raw(icon('chevron-left', { size: 14 }))}</button>
                    <button class="v3-ghost-btn v3-btn-md" data-action="this-week">This week</button>
                    <button class="v3-ghost-btn v3-btn-md" data-action="week" data-delta="7"
                            aria-label="Next week">${raw(icon('chevron-right', { size: 14 }))}</button>
                </div>
            </div>
            <div class="v3-page-body" data-role="body">
                <div class="v3-skeleton">Loading the week…</div>
            </div>
        `);

        this.bind();
        await this.load();

        [EVENTS.ATTENDANCE_SAVED, EVENTS.BATCH_UPDATED, EVENTS.SESSION_POSTPONED,
         EVENTS.SESSION_CANCELLED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    async load() {
        try {
            const days = await timetable(session.branch(), this.weekStart);
            if (this.disposed) return;
            this.days = days;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Timetable failed to load', err);
            render(this.container.querySelector('[data-role="body"]'), html`
                <div class="v3-error">The week could not be loaded — ${err.message}</div>
            `);
        }
    }

    paint() {
        const today = localDate();
        const weekEnd = addDays(this.weekStart, 6);
        const total = this.days.reduce((sum, day) => sum + day.sessions.length, 0);
        const marked = this.days.reduce(
            (sum, day) => sum + day.sessions.filter((s) => s.registerMarked).length, 0);

        render(this.container.querySelector('[data-role="subtitle"]'),
            `${formatDate(this.weekStart)} – ${formatDate(weekEnd)} · ${marked} of ${total} register${total === 1 ? '' : 's'} marked`);

        render(this.container.querySelector('[data-role="body"]'), html`
            <div class="v3-week">
                ${this.days.map((day) => html`
                    <section class="v3-week-day" data-today="${day.sessions[0]?.date === today ? 'true' : 'false'}">
                        <header class="v3-week-head">
                            <span class="v3-week-day-name">${day.day}</span>
                            <span class="v3-week-date">${dayNumber(this.weekStart, day.day)}</span>
                        </header>
                        <div class="v3-week-slots">
                            ${day.sessions.length ? day.sessions.map((slot) => this.tile(slot, today)) : html`
                                <p class="v3-week-empty">—</p>
                            `}
                        </div>
                    </section>
                `)}
            </div>

            <section class="v3-card">
                <div class="v3-card-head">
                    <h2 class="v3-card-title">Legend</h2>
                </div>
                <div class="v3-card-body v3-legend">
                    <span class="v3-legend-item"><i class="v3-swatch" data-state="marked"></i> Register marked</span>
                    <span class="v3-legend-item"><i class="v3-swatch" data-state="due"></i> Needs marking</span>
                    <span class="v3-legend-item"><i class="v3-swatch" data-state="upcoming"></i> Upcoming</span>
                    <span class="v3-legend-item"><i class="v3-swatch" data-state="cancelled"></i> Cancelled</span>
                    <span class="v3-legend-item"><i class="v3-swatch" data-state="replacement"></i> Replacement class</span>
                </div>
            </section>
        `);
    }

    /**
     * One tile. Per the design note quoted in this file's header, it carries
     * the batch name and its time slot only — teacher and level live on the
     * tooltip so the grid stays a grid.
     */
    tile(slot, today) {
        const cancelled = slot.sessionStatus === 'cancelled';
        // A class in the future cannot have its register marked at all, so
        // "needs marking" is only meaningful once the date has arrived. The
        // rule itself is the service's — asked, not re-implemented.
        const past = slot.date <= today;
        const state = cancelled ? 'cancelled'
            : slot.registerMarked ? 'marked'
            : slot.isReplacement ? 'replacement'
            : past ? 'due' : 'upcoming';

        const markable = !cancelled && markingWindow(slot.date).markable && session.can('attendance.view');

        return html`
            <button class="v3-slot" data-state="${state}"
                    data-action="open" data-batch="${slot.id}" data-date="${slot.date}"
                    ${markable ? '' : 'disabled'}
                    title="${slot.name} · ${slot.startTime}–${slot.endTime} · ${slot.teacherName}${slot.levelLabel ? ` · ${slot.levelLabel}` : ''}">
                <span class="v3-slot-name">${slot.name}</span>
                <span class="v3-slot-time">${slot.startTime}–${slot.endTime}</span>
            </button>
        `;
    }

    bind() {
        const root = this.container;

        this.onDispose(on(root, 'click', '[data-action="week"]', (_e, target) => {
            this.weekStart = addDays(this.weekStart, Number(target.dataset.delta));
            this.load();
        }));
        this.onDispose(on(root, 'click', '[data-action="this-week"]', () => {
            this.weekStart = startOfWeek();
            this.load();
        }));

        // The tile is Attendance's front door — this is the route that lets
        // Attendance go back to being hidden from the sidebar.
        this.onDispose(on(root, 'click', '[data-action="open"]', (_e, target) => {
            router.go(`/attendance?date=${target.dataset.date}&batch=${target.dataset.batch}`);
        }));
    }
}

/* ------------------------------------------------------------------ HELPERS */

const WEEK_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The calendar date a weekday column stands for, in this displayed week. */
function dayNumber(weekStart, dayName) {
    const index = WEEK_ORDER.indexOf(dayName);
    if (index < 0) return '';
    return formatDate(addDays(weekStart, index), { withYear: false });
}

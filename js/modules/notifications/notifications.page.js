/**
 * Natyam ERP v3 — Admin — Notifications
 *
 * NO APPROVED v3 DESIGN EXISTS FOR THIS SCREEN — Notifications was never part
 * of the Claude Design project (see docs/design/README.md). Built from the v3
 * system already proven across six screens.
 *
 * Two things come straight from the service and are not re-decided here:
 *
 *   - **Severity, not kind, drives the ordering.** `centre()` maps each row to
 *     error / warning / success / info, on the stated grounds that *"what must
 *     I deal with" is the question being asked and the kind is only a hint
 *     towards the answer*. This page sorts unread-and-urgent to the top and
 *     renders that severity; it does not invent its own.
 *   - **Announcements are notifications with a flag**, not a second store, so
 *     they share read state and pruning. They are shown in their own section
 *     because they are written *by* the school rather than derived *about* it.
 *
 * ONE DELIBERATE DIFFERENCE FROM THE REFERENCE APP. There, `refreshAlerts()`
 * runs automatically during the boot maintenance sweep. v3's `app.js` does not
 * carry that sweep, so derived alerts would silently go stale. Rather than
 * reintroduce background writes at every launch — Firestore writes the user
 * did not ask for, on a plan where reads and writes are metered — regenerating
 * is an explicit button here. See MIGRATION_CHECKLIST.md.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { relativeTime, formatDateLong } from '../../utils/date.js';
import {
    centre, markRead, markAllRead, dismiss, refreshAlerts,
    announce, removeAnnouncement
} from '../../services/notifications.service.js';
import { CAPABILITIES } from '../../config/app.config.js';
import { formModal, confirmModal } from '../../ui/form.js';

const SEVERITY_ORDER = { error: 0, warning: 1, success: 2, info: 3 };

const FILTERS = [
    { key: null, label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'error', label: 'Urgent' },
    { key: 'warning', label: 'Needs attention' }
];

export default class NotificationsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Notifications';
        this.data = null;
        this.filter = this.query.filter || null;
        this.busy = false;
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head v3-page-head-row">
                <div>
                    <h1 class="v3-page-title">Notifications</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading…</p>
                </div>
                <div class="v3-head-actions">
                    <button class="v3-ghost-btn v3-btn-md" data-action="refresh">
                        ${raw(icon('refresh-cw', { size: 14 }))} Refresh alerts
                    </button>
                    <button class="v3-ghost-btn v3-btn-md" data-action="mark-all">Mark all read</button>
                    ${session.can(CAPABILITIES.SETTINGS_EDIT) ? html`
                        <button class="v3-action-btn v3-btn-md" data-action="post-announcement">
                            ${raw(icon('plus', { size: 14 }))} Post announcement
                        </button>
                    ` : ''}
                </div>
            </div>
            <div class="v3-page-body" data-role="body">
                <div class="v3-skeleton">Loading notifications…</div>
            </div>
        `);

        this.bind();
        await this.load();

        [EVENTS.NOTIFICATION_ADDED, EVENTS.NOTIFICATION_READ]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    async load() {
        try {
            const data = await centre();
            if (this.disposed) return;
            this.data = data;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Notifications failed to load', err);
            render(this.container.querySelector('[data-role="body"]'), html`
                <div class="v3-error">Notifications could not be loaded — ${err.message}</div>
            `);
        }
    }

    /** Unread first, then by severity, then newest — a worklist, not a log. */
    visibleRows() {
        let rows = [...(this.data?.rows || [])];

        if (this.filter === 'unread') rows = rows.filter((r) => !r.read);
        else if (this.filter) rows = rows.filter((r) => r.severity === this.filter);

        return rows.sort((a, b) =>
            (Number(Boolean(a.read)) - Number(Boolean(b.read)))
            || (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
            || (b.at || '').localeCompare(a.at || ''));
    }

    paint() {
        const d = this.data;
        const rows = this.visibleRows();

        render(this.container.querySelector('[data-role="subtitle"]'),
            d ? `${d.unread} unread · ${d.rows.length} in the last 100` : '');

        render(this.container.querySelector('[data-role="body"]'), html`
            ${d?.counts ? html`
                <div class="v3-chips">
                    ${FILTERS.map((f) => html`
                        <button class="v3-pill" data-action="filter" data-key="${f.key || ''}"
                                aria-pressed="${this.filter === f.key ? 'true' : 'false'}">
                            ${f.label}${f.key === 'error' && d.counts.error ? ` (${d.counts.error})` : ''}${f.key === 'warning' && d.counts.warning ? ` (${d.counts.warning})` : ''}${f.key === 'unread' && d.unread ? ` (${d.unread})` : ''}
                        </button>
                    `)}
                </div>
            ` : ''}

            ${d?.announcements?.length ? html`
                <section class="v3-card">
                    <div class="v3-card-head">
                        <h2 class="v3-card-title">Announcements</h2>
                        <p class="v3-card-note">Written by the school, pinned notices first.</p>
                    </div>
                    <div class="v3-list">
                        ${d.announcements.map((a) => html`
                            <div class="v3-row">
                                <span class="v3-dot" data-severity="${a.pinned ? 'medium' : 'low'}"></span>
                                <div class="v3-row-main">
                                    <div class="v3-row-title">
                                        ${a.pinned ? '📌 ' : ''}${a.title}
                                    </div>
                                    ${a.body ? html`<div class="v3-row-detail">${a.body}</div>` : ''}
                                    <div class="v3-row-detail">
                                        ${a.author || 'The school'}${a.at ? ` · ${formatDateLong(a.at)}` : ''}
                                    </div>
                                </div>
                                ${session.can(CAPABILITIES.SETTINGS_EDIT) ? html`
                                    <button class="v3-ghost-btn v3-btn-sm" data-action="remove-announcement"
                                            data-id="${a.id}">Take down</button>
                                ` : ''}
                            </div>
                        `)}
                    </div>
                </section>
            ` : ''}

            <section class="v3-card">
                <div class="v3-card-head"><h2 class="v3-card-title">Alerts</h2></div>
                ${rows.length ? html`
                    <div class="v3-list">
                        ${rows.map((row) => html`
                            <div class="v3-note" data-severity="${row.severity}" data-read="${row.read ? 'true' : 'false'}">
                                <span class="v3-note-icon" data-severity="${row.severity}">
                                    ${raw(icon(row.meta?.icon || 'info', { size: 16 }))}
                                </span>
                                <div class="v3-row-main">
                                    <div class="v3-row-title">${row.title}</div>
                                    ${row.body ? html`<div class="v3-row-detail">${row.body}</div>` : ''}
                                    <div class="v3-row-detail">${row.at ? relativeTime(row.at) : ''}</div>
                                </div>
                                <div class="v3-note-actions">
                                    ${row.link ? html`
                                        <a class="v3-ghost-btn" href="${row.link}" data-action="open" data-id="${row.id}">Open</a>
                                    ` : ''}
                                    ${!row.read ? html`
                                        <button class="v3-ghost-btn" data-action="read" data-id="${row.id}">Mark read</button>
                                    ` : ''}
                                    <button class="v3-icon-btn" data-action="dismiss" data-id="${row.id}" aria-label="Dismiss">
                                        ${raw(icon('x', { size: 14 }))}
                                    </button>
                                </div>
                            </div>
                        `)}
                    </div>
                ` : html`
                    <div class="v3-empty">
                        ${this.filter ? 'Nothing matches that filter.' : 'Nothing to deal with — the school is up to date.'}
                    </div>
                `}
            </section>
        `);
    }

    /* --------------------------------------------------------- ANNOUNCEMENTS */

    /**
     * Posting a notice.
     *
     * `announce()` has been sitting in notifications.service.js, fully written
     * and permission-gated, with no caller in either app — the centre could
     * display announcements but nothing could create one. This is that caller;
     * the service needed no changes.
     *
     * The post reaches every subscribed device through the onAnnouncementPosted
     * trigger and cannot be recalled. The dialog says so, because the author
     * cannot be expected to know how far it travels.
     */
    async postAnnouncement() {
        const posted = await formModal({
            title: 'Post an announcement',
            description: 'Appears for everyone in both apps, and pushes to devices with '
                + 'Announcements switched on. It cannot be unsent.',
            submitLabel: 'Post announcement',
            fields: [
                { name: 'title', label: 'Announcement', required: true,
                  placeholder: 'Hall change for Saturday' },
                { name: 'body', label: 'Details', type: 'textarea',
                  help: 'Optional. Shown under the title.' },
                { name: 'pinned', label: 'Keep at the top', type: 'switch',
                  help: 'Pinned notices sort above the rest until taken down.' }
            ],
            values: { pinned: false },
            onSubmit: (v) => announce({
                title: v.title,
                body: v.body,
                pinned: Boolean(v.pinned)
            })
        });

        if (!posted) return;
        toast.success('Announcement posted', posted.title);
        await this.load();
    }

    /**
     * "Take down", not "delete" — that is honestly all it can do. A push
     * already delivered is on people's phones and nothing here reaches it.
     */
    async takeDownAnnouncement(id) {
        const a = (this.data?.announcements || []).find((x) => x.id === id);
        if (!a) return;

        const ok = await confirmModal({
            title: `Take down "${a.title}"?`,
            message: 'It disappears from both apps for everyone. Any push already delivered '
                + 'stays on the devices that received it.',
            confirmLabel: 'Take down',
            tone: 'caution'
        });
        if (!ok) return;

        await this.run('Taking down', async () => {
            await removeAnnouncement(id);
            toast.success('Announcement taken down', a.title);
        });
    }

    /* --------------------------------------------------------------- ACTIONS */

    async run(label, fn) {
        if (this.busy) return;
        this.busy = true;
        try {
            await fn();
            await this.load();
        } catch (err) {
            if (!this.disposed) toast.error(`${label} failed — ${err.message}`);
        } finally {
            this.busy = false;
        }
    }

    bind() {
        const root = this.container;

        this.onDispose(on(root, 'click', '[data-action="filter"]', (_e, t) => {
            const key = t.dataset.key || null;
            this.filter = this.filter === key ? null : key;
            this.paint();
        }));

        this.onDispose(on(root, 'click', '[data-action="read"]', (_e, t) =>
            this.run('Marking read', () => markRead(t.dataset.id))));

        this.onDispose(on(root, 'click', '[data-action="dismiss"]', (_e, t) =>
            this.run('Dismissing', () => dismiss(t.dataset.id))));

        this.onDispose(on(root, 'click', '[data-action="mark-all"]', () =>
            this.run('Marking all read', () => markAllRead())));

        // Opening a notification marks it read — following the link is the
        // strongest possible signal that it has been dealt with. Navigation is
        // left to the anchor's own href.
        this.onDispose(on(root, 'click', '[data-action="open"]', (_e, t) => {
            const row = this.data?.rows.find((r) => r.id === t.dataset.id);
            if (row && !row.read) markRead(row.id).catch(() => {});
        }));

        this.onDispose(on(root, 'click', '[data-action="post-announcement"]', () => this.postAnnouncement()));
        this.onDispose(on(root, 'click', '[data-action="remove-announcement"]', (_e, t) =>
            this.takeDownAnnouncement(t.dataset.id)));

        this.onDispose(on(root, 'click', '[data-action="refresh"]', () =>
            this.run('Refreshing alerts', async () => {
                const written = await refreshAlerts({ branchId: session.branch() });
                toast.success('Alerts refreshed', `${written} alert${written === 1 ? '' : 's'} recalculated.`);
            })));
    }
}

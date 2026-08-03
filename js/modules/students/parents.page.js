/**
 * Natyam ERP v3 — Admin — Parents and households
 *
 * There is no parent record in this system, and that is a decision rather than
 * an omission. A guardian here has no login, no portal and no existence that
 * outlives their child's enrolment; giving them their own store would create a
 * second place for a phone number to be wrong and a reconciliation job nobody
 * would ever run.
 *
 * So a household is *derived* — by `students.service.households()`, from the
 * students who share a contact number. This page is a view over that
 * derivation: a directory for the office to ring families, spot siblings, and
 * find the records where the school has no way to reach anyone at all.
 *
 * That last case is the reason this screen exists at all, so it is not left to
 * be noticed: a household with no number is called out in the list and again
 * at the top of its own panel.
 *
 * NO DESIGN FILE. `Parents.dc.html` was never generated — the design project
 * was deleted before Phase 2 (see docs/design/README.md). Rather than invent a
 * new layout, this reuses the Students screen's established v3 shapes: the KPI
 * strip, the filter bar with pills, the `v3-roll` card list, and the centred
 * detail modal. Consistent by construction with a screen that *does* have an
 * approved design, which is the safer of the two ways to be wrong.
 *
 * WHY EDITING WRITES TO EVERY CHILD. The contact details live on each student
 * record, because that is where the schema keeps them. Editing them here fans
 * the change out across every child in the household in one go — which is the
 * whole point of grouping them. The dialog says how many records it will touch
 * before it touches them.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on, debounce } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatMoney, formatNumber } from '../../utils/money.js';
import { CAPABILITIES } from '../../config/app.config.js';
import { households, householdSummary, updateStudent } from '../../services/students.service.js';
import { formModal } from '../../ui/form.js';

/** Filter pills. `null` means every household. */
const FILTERS = [
    { key: null, label: 'All' },
    { key: 'siblings', label: 'More than one child' },
    { key: 'owing', label: 'Owing fees' },
    { key: 'no-phone', label: 'No phone' },
    { key: 'no-email', label: 'No email' }
];

export default class ParentsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Parents';
        this.filter = this.query.filter || null;
        this.search = '';
        this.groups = [];
        this.stats = null;
        this.open = null;
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head">
                <div>
                    <h1 class="v3-page-title">Parents</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading…</p>
                </div>
            </div>
            <div class="v3-page-body">
                <div data-role="summary"></div>
                <section class="v3-filterbar">
                    <div class="v3-filter-row">
                        <label class="v3-search-field">
                            ${raw(icon('search', { size: 15 }))}
                            <span class="sr-only">Search households</span>
                            <input type="search" data-role="search"
                                   placeholder="Search guardian, phone or child…">
                        </label>
                    </div>
                    <div class="v3-chips" data-role="chips"></div>
                </section>
                <section class="v3-card" data-role="list">
                    <div class="v3-skeleton">Assembling households…</div>
                </section>
            </div>
            <div data-role="modal"></div>
        `);

        this.bind();
        await this.load();

        [EVENTS.STUDENT_CREATED, EVENTS.STUDENT_UPDATED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    async load() {
        try {
            const [groups, stats] = await Promise.all([
                households(session.branch()),
                householdSummary(session.branch())
            ]);
            if (this.disposed) return;
            this.groups = groups;
            this.stats = stats;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Households could not be assembled', err);
            render(this.container.querySelector('[data-role="list"]'), html`
                <div class="v3-empty">Households could not be assembled — ${err.message}</div>
            `);
        }
    }

    visibleRows() {
        let rows = this.groups.filter((g) => {
            if (this.filter === 'siblings') return g.size > 1;
            if (this.filter === 'owing') return g.outstanding > 0;
            if (this.filter === 'no-phone') return !g.contactable;
            if (this.filter === 'no-email') return !g.email;
            return true;
        });

        const term = this.search.trim().toLowerCase();
        if (term) {
            rows = rows.filter((g) =>
                [g.guardianName, g.phone, g.email, ...g.children.map((c) => c.name)]
                    .some((v) => String(v || '').toLowerCase().includes(term)));
        }
        return rows;
    }

    paint() {
        const rows = this.visibleRows();
        const s = this.stats || {};

        render(this.container.querySelector('[data-role="subtitle"]'),
            `${rows.length} of ${this.groups.length} household${this.groups.length === 1 ? '' : 's'}`);

        render(this.container.querySelector('[data-role="summary"]'), html`
            <div class="v3-kpis">
                ${kpi('Households', formatNumber(s.households || 0), 'neutral')}
                ${kpi('With siblings', formatNumber(s.multiChild || 0), 'neutral')}
                ${kpi('Unreachable', formatNumber(s.missingPhone || 0),
                      s.missingPhone ? 'negative' : 'positive',
                      s.missingPhone ? 'No phone number on file' : 'Every family has a number')}
                ${kpi('Owing', formatMoney(s.totalOutstanding || 0),
                      s.totalOutstanding ? 'caution' : 'positive',
                      `${formatNumber(s.owing || 0)} household${s.owing === 1 ? '' : 's'}`)}
            </div>
        `);

        render(this.container.querySelector('[data-role="chips"]'), html`
            ${FILTERS.map((f) => html`
                <button class="v3-pill" data-action="filter" data-key="${f.key || ''}"
                        aria-pressed="${this.filter === f.key ? 'true' : 'false'}">${f.label}</button>
            `)}
        `);

        render(this.container.querySelector('[data-role="list"]'), rows.length ? html`
            <div class="v3-roll">
                ${rows.map((g) => html`
                    <button class="v3-roll-row" data-action="open" data-key="${g.key}">
                        <span class="v3-roll-main">
                            <span class="v3-roll-name">
                                ${g.guardianName}
                                ${g.size > 1 ? html`
                                    <span class="v3-chip" style="margin-left:8px;">${g.size} children</span>
                                ` : ''}
                            </span>
                            <span class="v3-roll-meta">
                                ${g.guardianRelation}${g.phone ? ` · ${g.phone}` : ''}
                                · ${g.children.map((c) => c.name).join(', ')}
                            </span>
                        </span>
                        ${!g.contactable ? html`
                            <span class="v3-chip" data-fee="overdue">No number</span>
                        ` : ''}
                        <span class="v3-chip" data-fee="${g.outstanding > 0 ? 'overdue' : 'clear'}">
                            ${g.outstanding > 0 ? formatMoney(g.outstanding) : 'Clear'}
                        </span>
                    </button>
                `)}
            </div>
        ` : html`
            <div class="v3-empty">
                ${this.groups.length
                    ? 'No household matches that.'
                    : 'Households appear as soon as students have a guardian phone number.'}
            </div>
        `);

        this.paintDetail();
    }

    /* ---------------------------------------------------------------- DETAIL */

    paintDetail() {
        const target = this.container.querySelector('[data-role="modal"]');
        const g = this.open;
        if (!g) { render(target, ''); return; }

        render(target, html`
            <div class="v3-modal-scrim" data-role="scrim">
                <div class="v3-modal" role="dialog" aria-modal="true" aria-label="${g.guardianName}">
                    <div class="v3-modal-head">
                        <div>
                            <h2 class="v3-modal-title">${g.guardianName}</h2>
                            <p class="v3-modal-sub">
                                ${g.guardianRelation} · ${g.size} child${g.size === 1 ? '' : 'ren'} on the roll
                            </p>
                        </div>
                        <button class="v3-modal-close" data-action="close-detail" aria-label="Close">
                            ${raw(icon('x', { size: 15 }))}
                        </button>
                    </div>

                    <div class="v3-modal-body">
                        ${!g.contactable ? html`
                            <div class="v3-notice" data-tone="negative">
                                There is no phone number on any of these records. If something
                                happened in class there would be nobody to call.
                            </div>
                        ` : ''}

                        <div class="v3-facts">
                            ${fact('Phone', g.phone || '—')}
                            ${fact('Email', g.email || '—')}
                            ${fact('Emergency contact', g.alternatePhone || '—')}
                            ${fact('Owed', g.outstanding > 0 ? formatMoney(g.outstanding) : 'Nothing')}
                        </div>
                        ${g.address ? html`<p class="v3-modal-note">${g.address}</p>` : ''}

                        <h3 class="v3-card-title" style="font-size:14px;">Children</h3>
                        <div class="v3-roll">
                            ${g.children.map((c) => html`
                                <a class="v3-roll-row" href="#/students?student=${c.id}">
                                    <span class="v3-roll-main">
                                        <span class="v3-roll-name">${c.name}</span>
                                        <span class="v3-roll-meta">
                                            ${c.levelLabel || '—'}${c.batchName ? ` · ${c.batchName}` : ' · No batch'}
                                        </span>
                                    </span>
                                    <span class="v3-chip" data-fee="${c.outstanding > 0 ? 'overdue' : 'clear'}">
                                        ${c.outstanding > 0 ? formatMoney(c.outstanding) : 'Clear'}
                                    </span>
                                </a>
                            `)}
                        </div>
                    </div>

                    <div class="v3-modal-foot">
                        <button class="v3-ghost-btn v3-btn-md" data-action="close-detail">Close</button>
                        ${g.phone ? html`
                            <a class="v3-ghost-btn v3-btn-md" href="tel:${g.phone}">Call</a>
                        ` : ''}
                        ${session.can(CAPABILITIES.STUDENT_EDIT) ? html`
                            <button class="v3-action-btn v3-btn-md" data-action="edit-contacts">
                                Edit contact details
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `);
    }

    /**
     * Edits the contact details for a whole household.
     *
     * There is nothing to update *but* the children — the household is derived,
     * not stored — so this writes the same values to every child's record. The
     * submit button says how many that is, because "Save" would understate what
     * is about to happen.
     */
    async editContacts() {
        const g = this.open;
        if (!g) return;

        const saved = await formModal({
            title: `Contact details — ${g.guardianName}`,
            description: `Stored on each child's record, so this updates all `
                       + `${g.size} of them.`,
            submitLabel: `Update ${g.size} record${g.size === 1 ? '' : 's'}`,
            fields: [
                { name: 'guardianName', label: 'Guardian name', required: true },
                { name: 'guardianRelation', label: 'Relationship', type: 'select',
                  options: ['Mother', 'Father', 'Grandparent', 'Guardian', 'Sibling']
                      .map((r) => ({ value: r, label: r })) },
                { name: 'guardianPhone', label: 'Phone', type: 'tel', required: true,
                  help: 'Changing this regroups the household — it is what siblings are matched on.' },
                { name: 'guardianEmail', label: 'Email', type: 'email' },
                { name: 'alternatePhone', label: 'Emergency contact', type: 'tel' },
                { name: 'address', label: 'Address', type: 'textarea', rows: 2 }
            ],
            values: {
                guardianName: g.guardianName === 'Not recorded' ? '' : g.guardianName,
                guardianRelation: g.guardianRelation || 'Mother',
                guardianPhone: g.phone || '',
                guardianEmail: g.email || '',
                alternatePhone: g.alternatePhone || '',
                address: g.address || ''
            },
            onSubmit: async (values) => {
                // Sequential rather than Promise.all: these are writes to the
                // same household, and if the third one fails it matters that
                // the first two are already done and reported, not lost inside
                // a rejected batch.
                let written = 0;
                for (const child of g.children) {
                    await updateStudent(child.id, values).catch((err) => {
                        throw new Error(
                            `${written} of ${g.size} record${g.size === 1 ? '' : 's'} updated, then `
                            + `${child.name} failed: ${err.message}`);
                    });
                    written += 1;
                }
                return { written };
            }
        });

        if (!saved) return;
        toast.success(
            `Updated ${saved.written} record${saved.written === 1 ? '' : 's'}`,
            g.guardianName);
        this.open = null;
        await this.load();
    }

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
            // paint() replaced the field; restore focus and caret.
            const field = root.querySelector('[data-role="search"]');
            if (field && document.activeElement !== field) {
                field.focus();
                field.setSelectionRange(field.value.length, field.value.length);
            }
        }, 180)));

        this.onDispose(on(root, 'click', '[data-action="open"]', (_e, t) => {
            this.open = this.groups.find((g) => g.key === t.dataset.key) || null;
            this.paintDetail();
        }));
        this.onDispose(on(root, 'click', '[data-action="close-detail"]', () => {
            this.open = null;
            this.paintDetail();
        }));
        // Only a direct hit on the backdrop closes — the scrim wraps the
        // dialog, so a delegated closest() match would otherwise treat every
        // click inside it as a click on the backdrop.
        this.onDispose(on(root, 'click', '[data-role="scrim"]', (event, target) => {
            if (event.target !== target) return;
            this.open = null;
            this.paintDetail();
        }));
        this.onDispose(on(root, 'click', '[data-action="edit-contacts"]', () => this.editContacts()));

        this.onKey = (event) => {
            if (event.key === 'Escape' && this.open) { this.open = null; this.paintDetail(); }
        };
        window.addEventListener('keydown', this.onKey);
        this.onDispose(() => window.removeEventListener('keydown', this.onKey));
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

function fact(label, value) {
    return html`<div class="v3-fact"><dt>${label}</dt><dd>${value}</dd></div>`;
}

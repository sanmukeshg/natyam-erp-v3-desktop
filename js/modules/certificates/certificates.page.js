/**
 * Natyam ERP v3 — Admin — Certificates
 *
 * A certificate is the only artefact this system produces that leaves the
 * building and outlives it. A parent will present a Foundation Level 5
 * certificate to a college admissions officer in eleven years' time, and the
 * only thing standing behind it will be a serial number this module minted.
 *
 * THREE RULES THIS SCREEN HONOURS RATHER THAN REIMPLEMENTS, all the service's:
 *
 *  - **Eligibility is asked, never guessed.** `checkEligibility()` returns a
 *    list of reasons, not a boolean, so the issue dialog shows every reason at
 *    once instead of revealing them one refused submit at a time.
 *  - **Overriding is possible and permanent.** `force` exists for the real case
 *    — a guru issuing to a student who was ill through the attendance window —
 *    and demands a reason that is stored on the certificate itself. The dialog
 *    only reveals the override once the service has actually objected, so it is
 *    never the path of least resistance.
 *  - **Nothing is ever deleted, only revoked**, and a revoked serial still
 *    verifies. So this screen has no delete, and the revoke dialog says the
 *    serial stays checkable.
 *
 * NO DESIGN FILE. Reuses the shapes Students, Parents, Staff and Programmes
 * established.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on, debounce } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatNumber } from '../../utils/money.js';
import { formatDateLong } from '../../utils/date.js';
import { CAPABILITIES, levelLabel } from '../../config/app.config.js';
import {
    TEMPLATES, listCertificates, certificateSummary,
    checkEligibility, issue, revoke, verify, printData
} from '../../services/certificates.service.js';
import { listStudents } from '../../services/students.service.js';
import { listPrograms, PROGRAM_STATUS } from '../../services/programs.service.js';
import { formModal, confirmModal } from '../../ui/form.js';

const FILTERS = [
    { key: null, label: 'All' },
    { key: 'issued', label: 'Valid' },
    { key: 'revoked', label: 'Revoked' },
    { key: 'overridden', label: 'Overridden' }
];

export default class CertificatesPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Certificates';
        this.filter = this.query.filter || null;
        this.search = '';
        this.rows = [];
        this.stats = null;
        this.detail = null;
    }

    async render(container) {
        this.container = container;

        render(container, html`
            <div class="v3-page-head v3-page-head-row">
                <div>
                    <h1 class="v3-page-title">Certificates</h1>
                    <p class="v3-page-sub" data-role="subtitle">Loading…</p>
                </div>
                <div class="v3-head-actions">
                    <button class="v3-ghost-btn v3-btn-md" data-action="verify">
                        ${raw(icon('search', { size: 14 }))} Verify a serial
                    </button>
                    ${session.can(CAPABILITIES.CERTIFICATE_ISSUE) ? html`
                        <button class="v3-action-btn v3-btn-md" data-action="issue">
                            ${raw(icon('plus', { size: 14 }))} Issue
                        </button>
                    ` : ''}
                </div>
            </div>
            <div class="v3-page-body">
                <div data-role="summary"></div>
                <section class="v3-filterbar">
                    <div class="v3-filter-row">
                        <label class="v3-search-field">
                            ${raw(icon('search', { size: 15 }))}
                            <span class="sr-only">Search certificates</span>
                            <input type="search" data-role="search" placeholder="Search serial, student, title…">
                        </label>
                    </div>
                    <div class="v3-chips" data-role="chips"></div>
                </section>
                <section class="v3-card" data-role="list">
                    <div class="v3-skeleton">Loading certificates…</div>
                </section>
            </div>
            <div data-role="modal"></div>
        `);

        this.bind();
        await this.load();

        [EVENTS.CERTIFICATE_ISSUED, EVENTS.CERTIFICATE_REVOKED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    async load() {
        try {
            const [rows, stats] = await Promise.all([
                listCertificates({ branchId: session.branch() }),
                certificateSummary(session.branch())
            ]);
            if (this.disposed) return;
            this.rows = rows;
            this.stats = stats;
            this.paint();
        } catch (err) {
            if (this.disposed) return;
            console.error('Certificates failed to load', err);
            render(this.container.querySelector('[data-role="list"]'), html`
                <div class="v3-empty">Certificates could not be loaded — ${err.message}</div>
            `);
        }
    }

    visibleRows() {
        let rows = this.rows.filter((c) => {
            if (this.filter === 'issued') return c.status !== 'revoked';
            if (this.filter === 'revoked') return c.status === 'revoked';
            if (this.filter === 'overridden') return Boolean(c.overridden);
            return true;
        });

        const term = this.search.trim().toLowerCase();
        if (term) {
            rows = rows.filter((c) =>
                [c.serial, c.studentName, c.title, c.templateId]
                    .some((v) => String(v || '').toLowerCase().includes(term)));
        }
        return rows;
    }

    paint() {
        const rows = this.visibleRows();
        const s = this.stats || {};

        render(this.container.querySelector('[data-role="subtitle"]'),
            `${rows.length} of ${this.rows.length} certificate${this.rows.length === 1 ? '' : 's'}`);

        render(this.container.querySelector('[data-role="summary"]'), html`
            <div class="v3-kpis">
                ${kpi('Issued', formatNumber(s.total || 0), 'neutral',
                      `${formatNumber(s.thisYear || 0)} this academic year`)}
                ${kpi('Revoked', formatNumber(s.revoked || 0), s.revoked ? 'caution' : 'positive',
                      s.revoked ? 'Their serials still verify' : 'None')}
                ${kpi('Issued on override', formatNumber(s.overridden || 0),
                      s.overridden ? 'caution' : 'neutral',
                      s.overridden ? 'A rule was waived, with a reason on record' : 'No rules waived')}
                ${kpi('Kinds used', formatNumber((s.byTemplate || []).length), 'neutral',
                      (s.byTemplate || []).map((t) => `${t.name} ${t.count}`).join(' · ') || '—')}
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
                ${rows.map((c) => html`
                    <button class="v3-roll-row" data-action="open" data-id="${c.id}">
                        <span class="v3-roll-main">
                            <span class="v3-roll-name">
                                ${c.studentName || 'Unknown student'}
                                ${c.overridden ? html`
                                    <span class="v3-chip" style="margin-left:8px;">override</span>
                                ` : ''}
                            </span>
                            <span class="v3-roll-meta">
                                ${c.serial} · ${c.title || c.templateId}
                                ${c.issuedOn ? ` · ${formatDateLong(c.issuedOn)}` : ''}
                            </span>
                        </span>
                        <span class="v3-chip" data-fee="${c.status === 'revoked' ? 'overdue' : 'clear'}">
                            ${c.status === 'revoked' ? 'Revoked' : 'Valid'}
                        </span>
                    </button>
                `)}
            </div>
        ` : html`
            <div class="v3-empty">
                ${this.rows.length ? 'No certificate matches that.' : 'None issued yet.'}
            </div>
        `);

        this.paintDetail();
    }

    /* ---------------------------------------------------------------- DETAIL */

    async open(id) {
        try {
            this.detail = await printData(id);
            if (this.disposed) return;
            this.paintDetail();
        } catch (err) {
            toast.error(err.message);
        }
    }

    close() { this.detail = null; this.paintDetail(); }

    paintDetail() {
        const target = this.container.querySelector('[data-role="modal"]');
        const d = this.detail;
        if (!d) { render(target, ''); return; }

        const c = d.certificate || d;

        render(target, html`
            <div class="v3-modal-scrim" data-role="scrim">
                <div class="v3-modal" role="dialog" aria-modal="true" aria-label="${c.serial}">
                    <div class="v3-modal-head">
                        <div>
                            <h2 class="v3-modal-title">${c.title || 'Certificate'}</h2>
                            <p class="v3-modal-sub">${c.serial} · ${c.studentName || ''}</p>
                        </div>
                        <button class="v3-modal-close" data-action="close-detail" aria-label="Close">
                            ${raw(icon('x', { size: 15 }))}
                        </button>
                    </div>

                    <div class="v3-modal-body">
                        ${c.status === 'revoked' ? html`
                            <div class="v3-notice" data-tone="negative">
                                Revoked${c.revokedOn ? ` on ${formatDateLong(c.revokedOn)}` : ''}${c.revokeReason ? ` — ${c.revokeReason}` : ''}.
                                The serial still verifies, and returns this.
                            </div>
                        ` : ''}
                        ${c.overridden ? html`
                            <div class="v3-notice" data-tone="caution">
                                Issued on override — ${c.overrideReason || 'no reason recorded'}.
                            </div>
                        ` : ''}

                        <!--
                            The wording is read off the record, not regenerated from
                            the template. issue() renders title/body/signatories once
                            and stores them, so a certificate printed in 2037 says
                            exactly what it said the day it was issued — even if the
                            template, the curriculum or the school's name has changed
                            since. Re-rendering here would quietly rewrite history.
                        -->
                        ${c.body ? html`<p class="v3-modal-note">${c.body}</p>` : ''}

                        <div class="v3-facts">
                            ${fact('Serial', c.serial)}
                            ${fact('Student', c.studentName || '—')}
                            ${fact('Kind', c.templateName || c.templateId || '—')}
                            ${fact('Issued', c.issuedOn ? formatDateLong(c.issuedOn) : '—')}
                            ${fact('Academic year', c.academicYear || '—')}
                            ${c.level ? fact('Level', levelLabel(c.level)) : ''}
                        </div>

                        ${c.signatories?.length ? html`
                            <h3 class="v3-card-title" style="font-size:14px;">Signed by</h3>
                            <div class="v3-ops">
                                ${c.signatories.map((sig) => html`<span class="v3-chip">${sig}</span>`)}
                            </div>
                        ` : ''}

                        ${d.verifyHint ? html`<p class="v3-modal-note">${d.verifyHint}</p>` : ''}
                    </div>

                    <div class="v3-modal-foot">
                        <button class="v3-ghost-btn v3-btn-md" data-action="close-detail">Close</button>
                        ${c.status !== 'revoked' && session.can(CAPABILITIES.CERTIFICATE_ISSUE) ? html`
                            <button class="v3-action-btn v3-btn-md" data-action="revoke">Revoke</button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `);
    }

    /* ----------------------------------------------------------------- ISSUE */

    /**
     * Issuing.
     *
     * The flow is deliberately two-step: pick who and what, then let
     * `checkEligibility()` answer. Its refusals are shown *all at once* — it
     * returns an array of reasons precisely so a person is not told about the
     * attendance rule, fixes nothing, submits again and is then told about the
     * tenure rule.
     *
     * The override is only offered *after* a refusal. Putting a "force" switch
     * on the form from the start would make waiving the rules the easiest path
     * through it, which is the opposite of what a certificate needs.
     */
    async issueCertificate() {
        session.require(CAPABILITIES.CERTIFICATE_ISSUE, 'issue a certificate');

        const [students, programs] = await Promise.all([
            listStudents(session.branch()),
            listPrograms(session.branch(), { status: PROGRAM_STATUS.COMPLETED }).catch(() => [])
        ]);

        if (!students.length) {
            toast.error('Nobody to issue to', 'There are no students on the roll.');
            return;
        }

        const issued = await formModal({
            title: 'Issue a certificate',
            description: 'The serial is allocated when it is issued and never reused.',
            submitLabel: 'Check and issue',
            fields: [
                { name: 'studentId', label: 'Student', type: 'select', required: true,
                  placeholder: 'Choose a student',
                  options: students.map((s) => ({
                      value: s.id,
                      label: `${s.name}${s.level ? ` — ${levelLabel(s.level)}` : ''}`
                  })) },
                { name: 'templateId', label: 'Kind', type: 'select', required: true,
                  placeholder: 'Choose a kind',
                  options: TEMPLATES.map((t) => ({ value: t.id, label: t.name })) },
                // Only the participation template needs a programme, and only
                // completed programmes can be certified against.
                { name: 'programId', label: 'Programme', type: 'select',
                  placeholder: programs.length ? 'Choose a programme' : 'No completed programme yet',
                  options: programs.map((p) => ({
                      value: p.id, label: `${p.name} — ${formatDateLong(p.date)}`
                  })),
                  showIf: (v) => v.templateId === 'participation',
                  help: 'A participation certificate is issued against a completed programme.' },
                { name: 'citation', label: 'Citation', type: 'textarea', rows: 2,
                  showIf: (v) => v.templateId === 'merit',
                  help: 'What is being recognised. It is printed on the certificate.' },
                { name: 'issuedOn', label: 'Issued on', type: 'date' }
            ],
            values: { studentId: '', templateId: '', programId: '', citation: '', issuedOn: '' },
            onSubmit: async (v) => {
                const payload = {
                    studentId: v.studentId,
                    templateId: v.templateId,
                    programId: v.programId || null,
                    citation: v.citation || null
                };

                const check = await checkEligibility(payload);
                if (!check.ok) {
                    const reasons = check.reasons.join(' ');
                    const proceed = await confirmModal({
                        title: 'This does not meet the rules',
                        message: `${reasons} A certificate can still be issued, but the override is `
                               + 'recorded on it permanently and shows on every verification.',
                        confirmLabel: 'Issue on override',
                        tone: 'negative'
                    });
                    if (!proceed) throw new Error(reasons);

                    const reason = await formModal({
                        title: 'Why is this being overridden?',
                        description: 'Stored on the certificate itself, not just in a log.',
                        submitLabel: 'Issue',
                        fields: [{ name: 'overrideReason', label: 'Reason', required: true,
                                   placeholder: 'Ill through the attendance window…' }],
                        values: { overrideReason: '' },
                        onSubmit: (r) => r.overrideReason
                    });
                    if (!reason) throw new Error('Not issued. Nothing has changed.');

                    return issue({ ...payload, issuedOn: v.issuedOn || null,
                                   force: true, overrideReason: reason });
                }

                return issue({ ...payload, issuedOn: v.issuedOn || null });
            }
        });

        if (!issued) return;
        toast.success('Certificate issued', issued.serial);
        await this.load();
        this.open(issued.id);
    }

    async revokeCertificate() {
        const c = (this.detail?.certificate || this.detail);
        if (!c) return;

        const done = await formModal({
            title: `Revoke ${c.serial}`,
            description: 'The record is never deleted. The serial still verifies, and returns '
                       + 'the revocation and its reason.',
            submitLabel: 'Revoke',
            fields: [
                { name: 'reason', label: 'Why', required: true,
                  placeholder: 'Issued in error, superseded…',
                  help: 'Anyone verifying this serial will be shown this.' }
            ],
            values: { reason: '' },
            onSubmit: (v) => revoke(c.id, { reason: v.reason })
        });

        if (!done) return;
        toast.success('Revoked', c.serial);
        this.close();
        await this.load();
    }

    /**
     * Verifying a serial — the outward-facing half of this module.
     *
     * Reads rather than writes, so it needs no capability: an office junior
     * taking a phone call from an admissions officer should be able to answer
     * it. A revoked serial verifies *successfully* and says so; only a serial
     * that was never minted comes back not found.
     */
    async verifySerial() {
        await formModal({
            title: 'Verify a certificate',
            description: 'Type the serial exactly as printed.',
            submitLabel: 'Verify',
            fields: [
                { name: 'serial', label: 'Serial', required: true, placeholder: 'NAT/CRT/26/0001' }
            ],
            values: { serial: '' },
            // The answer is thrown rather than resolved so it stays on screen
            // beside the serial that was typed, instead of flashing past in a
            // toast while somebody is reading it down a telephone.
            //
            // `verify()` already writes the sentence — "Valid. Issued to X on
            // date", or the revocation with its reason — so it is shown as
            // written rather than reassembled here from the parts.
            onSubmit: async (v) => {
                const result = await verify(v.serial.trim());
                if (!result?.found) {
                    throw new Error(`No certificate has ever been issued with the serial "${v.serial.trim()}".`);
                }
                const c = result.certificate;
                throw new Error(
                    `${c.serial} — ${c.title || c.templateName || ''}. ${result.message}`
                    + (c.overridden
                        ? ` Issued on override: ${c.overrideReason || 'no reason recorded'}.`
                        : ''));
            }
        });
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
            const field = root.querySelector('[data-role="search"]');
            if (field && document.activeElement !== field) {
                field.focus();
                field.setSelectionRange(field.value.length, field.value.length);
            }
        }, 180)));

        this.onDispose(on(root, 'click', '[data-action="open"]', (_e, t) => this.open(t.dataset.id)));
        this.onDispose(on(root, 'click', '[data-action="close-detail"]', () => this.close()));
        this.onDispose(on(root, 'click', '[data-role="scrim"]', (event, target) => {
            if (event.target !== target) return;
            this.close();
        }));

        this.onDispose(on(root, 'click', '[data-action="issue"]', () => this.issueCertificate()));
        this.onDispose(on(root, 'click', '[data-action="revoke"]', () => this.revokeCertificate()));
        this.onDispose(on(root, 'click', '[data-action="verify"]', () => this.verifySerial()));

        this.onKey = (event) => { if (event.key === 'Escape' && this.detail) this.close(); };
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

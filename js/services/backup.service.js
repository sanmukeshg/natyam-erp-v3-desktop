/**
 * Natyam ERP v3 — Backup and restore
 *
 * OPTION B — chosen explicitly, Stage 26. This is a **Firestore-only** backup
 * service. It has no IndexedDB code path, cannot read a pre-Firestore backup
 * file, and does not pretend otherwise: a file it does not recognise is
 * refused by name rather than half-restored.
 *
 * That is why the whole file is a rewrite rather than a copy of the reference
 * project's `js/services/backup.service.js`. That one still carries `db` from
 * `core/db.js` — an envelope built by `db.exportAll()`, a `db.importAll()`
 * branch for stores that never moved, a `db.all()` fallback in the single-store
 * export, and a `db.clear()` loop in the erase. **v3 has no `core/db.js` at
 * all**; no device running it has ever held data locally. Carrying that code
 * would mean maintaining a path that could not run.
 *
 * WHAT IS KEPT FROM THE REFERENCE, because it was learned the hard way and the
 * comments there say so:
 *
 *  - **The envelope.** A bare dump of rows is unreadable in two years. Every
 *    file records the app version, schema version, when it was taken and by
 *    whom, so a future restore can tell whether it understands the file
 *    *before* it starts overwriting anything.
 *  - **A restore that recognises nothing must not proceed.** Clearing every
 *    collection and writing nothing back is the worst possible outcome of an
 *    operation someone reached for precisely because they wanted their data.
 *  - **Accounts are opt-in.** A backup must be able to describe who had access
 *    — otherwise a restore onto a fresh project yields a database full of
 *    records and nobody able to read them — but restoring accounts is a
 *    separate, deliberate decision.
 *  - **Erase works by exclusion, not by an allow-list.** COLLECTIONS below is
 *    the single source of truth; a collection added to it is backed up,
 *    restored and erased automatically. The reference's original bug was an
 *    allow-list that went stale the moment a collection moved, so an erase
 *    cleared twenty-four empty stores, reported success, and left every record
 *    in place.
 *  - **`curriculumLevels` is included.** It has no v3 screen, but it holds real
 *    records; a backup that silently omits a collection would quietly leave
 *    that data behind on restore.
 */

import { bus, EVENTS } from '../core/bus.js';
import { session } from '../core/session.js';
import { APP, SCHEMA, CAPABILITIES } from '../config/app.config.js';
import { nowISO, localDate, formatDateTime } from '../utils/date.js';
import { downloadFile } from '../utils/dom.js';
import {
    settings$, students$, admissions$, attendance$, classSessions$, programs$,
    certificates$, batches$, staff$, feePlans$, invoices$, payments$, ledger$,
    expenses$, salaries$, documents$, drafts$, notifications$, branches$,
    academicYears$, curricula$, curriculumLevels$, holidays$, audit$, users$
} from '../data/repositories.js';

const FILE_KIND = 'natyam-erp-backup';

/**
 * Every collection the school's records live in — the one source of truth for
 * what gets backed up, what a restore recognises, and what an erase clears.
 *
 * `soft: true` means the repository keeps soft-deleted rows, which a backup
 * must include: a restore that dropped them would silently resurrect records
 * somebody had deleted.
 */
const COLLECTIONS = Object.freeze([
    { key: 'students',         repo: students$,        soft: true },
    { key: 'admissions',       repo: admissions$,      soft: true },
    { key: 'attendance',       repo: attendance$,      soft: false },
    { key: 'classSessions',    repo: classSessions$,   soft: false },
    { key: 'programs',         repo: programs$,        soft: true },
    { key: 'certificates',     repo: certificates$,    soft: true },
    { key: 'batches',          repo: batches$,         soft: true },
    { key: 'staff',            repo: staff$,           soft: true },
    { key: 'feePlans',         repo: feePlans$,        soft: true },
    { key: 'invoices',         repo: invoices$,        soft: true },
    { key: 'payments',         repo: payments$,        soft: true },
    { key: 'ledgerEntries',    repo: ledger$,          soft: false },
    { key: 'expenses',         repo: expenses$,        soft: true },
    { key: 'salaries',         repo: salaries$,        soft: true },
    { key: 'documents',        repo: documents$,       soft: true },
    { key: 'admissionDrafts',  repo: drafts$,          soft: false },
    { key: 'notifications',    repo: notifications$,   soft: false },
    { key: 'branches',         repo: branches$,        soft: true },
    { key: 'academicYears',    repo: academicYears$,   soft: true },
    { key: 'curricula',        repo: curricula$,       soft: true },
    { key: 'curriculumLevels', repo: curriculumLevels$, soft: true },
    { key: 'holidays',         repo: holidays$,        soft: true },
    { key: 'auditLog',         repo: audit$,           soft: false },
    { key: 'settings',         repo: settings$,        soft: false }
]);

/** Accounts are handled apart from COLLECTIONS — see restore()'s `restoreUsers`. */
const USERS_SECTION = 'users';

const RECOGNISED = Object.freeze([...COLLECTIONS.map((c) => c.key), USERS_SECTION]);

/* ==========================================================================
   TAKING A BACKUP
   ========================================================================== */

/** Reads every collection live. No local store is consulted, because none exists. */
export async function buildBackup({ note = null } = {}) {
    const data = {};

    for (const { key, repo, soft } of COLLECTIONS) {
        data[key] = soft ? await repo.all({ includeDeleted: true }) : await repo.all();
    }

    // Sign-in accounts. A backup that cannot describe who had access is not a
    // backup of the installation — restoring one onto a fresh project would
    // produce a database full of records and no account able to read them.
    // Whether to *restore* them is a separate decision (see restore()).
    data[USERS_SECTION] = await users$.all({ includeDeleted: true });

    const counts = Object.fromEntries(Object.entries(data).map(([k, rows]) => [k, rows.length]));

    return {
        kind: FILE_KIND,
        app: APP.name,
        appVersion: APP.version,
        schemaVersion: SCHEMA.version,
        // Names the storage generation this file came from, so a future reader
        // can tell a v3 file from a pre-Firestore one without inspecting it.
        storage: 'firestore',
        takenAt: nowISO(),
        takenBy: session.actorName(),
        note: note?.trim() || null,
        counts,
        totalRecords: Object.values(counts).reduce((a, b) => a + b, 0),
        data
    };
}

/** Builds a backup and hands it to the browser as a download. */
export async function downloadBackup({ note = null } = {}) {
    session.require(CAPABILITIES.BACKUP_CREATE, 'take a backup');
    const backup = await buildBackup({ note });
    downloadFile(`natyam-backup-${localDate()}.json`, JSON.stringify(backup), 'application/json');
    bus.emit(EVENTS.BACKUP_CREATED, { backup: summarise(backup) });
    return summarise(backup);
}

/** What the school currently holds, without producing a file. */
export async function backupStatus() {
    const counts = {};
    for (const { key, repo, soft } of COLLECTIONS) {
        const rows = soft ? await repo.all({ includeDeleted: true }) : await repo.all();
        counts[key] = rows.length;
    }
    counts[USERS_SECTION] = (await users$.all({ includeDeleted: true })).length;

    return {
        counts,
        totalRecords: Object.values(counts).reduce((a, b) => a + b, 0),
        sections: Object.entries(counts)
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
    };
}

/* ==========================================================================
   READING A FILE
   ========================================================================== */

/**
 * Reads a backup file and reports what it contains — always called before a
 * restore, so the decision is made against the file's real contents rather
 * than its filename.
 */
export async function inspectBackup(file) {
    let parsed;
    try {
        parsed = JSON.parse(await file.text());
    } catch {
        throw new Error('That file is not readable JSON, so it is not a backup this app can use.');
    }

    if (parsed.kind !== FILE_KIND) {
        throw new Error('That is not a NATYAM ERP backup file.');
    }
    if (!parsed.data || typeof parsed.data !== 'object') {
        throw new Error('That backup has no data section, so there is nothing to restore.');
    }

    const sections = Object.keys(parsed.data);
    const recognised = sections.filter((s) => RECOGNISED.includes(s));
    const unknown = sections.filter((s) => !RECOGNISED.includes(s));

    /*
     * OPTION B, stated plainly rather than discovered mid-restore.
     *
     * A pre-Firestore file is structurally a backup — same `kind`, same
     * envelope — but its sections are IndexedDB store names this app has no
     * repository for. Rather than restoring the handful that happen to
     * overlap and silently dropping the rest, it is refused with the reason.
     */
    const legacy = !parsed.storage && recognised.length < sections.length / 2;

    return {
        kind: parsed.kind,
        app: parsed.app,
        appVersion: parsed.appVersion,
        schemaVersion: parsed.schemaVersion,
        storage: parsed.storage || 'indexeddb (pre-v3)',
        takenAt: parsed.takenAt,
        takenAtLabel: parsed.takenAt ? formatDateTime(parsed.takenAt) : 'unknown',
        takenBy: parsed.takenBy,
        note: parsed.note || null,
        totalRecords: parsed.totalRecords ?? sections.reduce((n, s) => n + (parsed.data[s]?.length || 0), 0),
        counts: parsed.counts || Object.fromEntries(sections.map((s) => [s, parsed.data[s]?.length || 0])),
        recognised,
        unknown,
        legacy,
        hasUsers: Array.isArray(parsed.data[USERS_SECTION]) && parsed.data[USERS_SECTION].length > 0,
        newerSchema: Number(parsed.schemaVersion) > Number(SCHEMA.version),
        backup: parsed
    };
}

/* ==========================================================================
   RESTORING
   ========================================================================== */

/**
 * Replaces the school's records with a backup's.
 *
 * Destructive by definition, so: a safety copy is downloaded first by default,
 * an unrecognisable file is refused before anything is touched, and accounts
 * are left alone unless explicitly asked for.
 */
export async function restore(backup, { safetyCopy = true, restoreUsers = false } = {}) {
    session.require(CAPABILITIES.DATA_RESTORE, 'restore from a backup');

    if (backup.kind !== FILE_KIND) throw new Error('That is not a NATYAM ERP backup file.');

    const sections = Object.keys(backup.data || {});
    const known = Object.fromEntries(
        Object.entries(backup.data || {}).filter(([key]) => RECOGNISED.includes(key))
    );

    // Refuse before touching anything, not after clearing.
    if (!Object.keys(known).length) {
        throw new Error(
            'This backup contains no data this version recognises, so nothing was changed. '
            + 'It is most likely a pre-v3 file taken when records were held on the device; '
            + 'v3 stores everything in Firestore and cannot read those.'
        );
    }
    if (!backup.storage && Object.keys(known).length < sections.length / 2) {
        throw new Error(
            `Only ${Object.keys(known).length} of ${sections.length} sections in this file are `
            + 'recognised. That is the signature of a pre-v3 backup, and restoring it would '
            + 'replace some collections while silently leaving others behind. Nothing was changed.'
        );
    }

    let safety = null;
    if (safetyCopy) {
        const current = await buildBackup({ note: 'Automatic safety copy taken before a restore' });
        if (current.totalRecords > 0) {
            downloadFile(`natyam-before-restore-${localDate()}.json`, JSON.stringify(current), 'application/json');
            safety = summarise(current);
        }
    }

    const restored = {};
    for (const { key, repo } of COLLECTIONS) {
        const rows = known[key];
        if (!rows) continue;                 // absent section: leave that collection alone
        await repo.replaceAll(rows);
        restored[key] = rows.length;
    }

    /*
     * Accounts, only if asked — and never the account doing the restoring.
     *
     * `restoreAll` rather than `replaceAll`: users$ deliberately has no
     * replaceAll, because wholesale-replacing the account collection is how
     * somebody locks themselves out of their own installation. `skipIds`
     * keeps the current signed-in account exactly as it is.
     */
    let usersRestored = { written: 0, skipped: 0 };
    if (restoreUsers && Array.isArray(known[USERS_SECTION])) {
        // Resolves to { written, skipped } — not a count. `skipped` is worth
        // surfacing: it is how the person learns their own account was left
        // alone rather than wondering why the numbers do not add up.
        usersRestored = await users$.restoreAll(known[USERS_SECTION], { skipIds: [session.actorId()] });
    }

    const result = {
        restored,
        sectionsRestored: Object.keys(restored).length,
        recordsRestored: Object.values(restored).reduce((a, b) => a + b, 0),
        usersRestored: usersRestored.written,
        usersSkipped: usersRestored.skipped,
        skipped: sections.filter((s) => !RECOGNISED.includes(s)),
        safety
    };

    bus.emit(EVENTS.BACKUP_RESTORED, result);
    return result;
}

/* ==========================================================================
   SINGLE-SECTION EXPORT
   ========================================================================== */

/** One collection as JSON, for handing to an accountant or an auditor. */
export async function exportStore(key, { pretty = true } = {}) {
    session.require(CAPABILITIES.DATA_EXPORT, 'export data');

    const entry = COLLECTIONS.find((c) => c.key === key)
        || (key === USERS_SECTION ? { key, repo: users$, soft: true } : null);
    if (!entry) throw new Error(`There is no "${key}" data to export.`);

    // Always the repository. The reference fell back to db.all() for anything
    // unmapped, which returned whatever stale rows IndexedDB last held rather
    // than what the app actually shows.
    const rows = entry.soft ? await entry.repo.all({ includeDeleted: true }) : await entry.repo.all();

    downloadFile(
        `natyam-${key}-${localDate()}.json`,
        JSON.stringify(rows, null, pretty ? 2 : 0),
        'application/json'
    );
    return { key, rows: rows.length };
}

/* ==========================================================================
   ERASING
   ========================================================================== */

/**
 * Empties every collection. The most destructive thing this application can
 * do, so it takes a safety copy first unless told not to.
 *
 * `keepInstitute` preserves CONFIGURATION — everything the Settings module
 * owns. The usual reason to erase is "clear the demo data and start entering
 * ours", and configuration is identical either way: a fee plan, a curriculum
 * level or a branch is the same whether the database holds test students or
 * real ones. Only the records ABOUT people are demo data.
 *
 * The rule is simply "if Settings edits it, this keeps it", and it is worth
 * stating because the list looks shorter than the Settings module does. Most
 * of those tabs write into `settings` itself rather than a collection of their
 * own: Curriculum is `curriculum.override`, and Roles, Programme types and
 * Expense categories are the same pattern (see settings.service.js's
 * STRUCTURAL_OVERRIDE_KEYS). So keeping `settings` already keeps four tabs.
 *
 * `feePlans` is the one that has its own collection, and it was missing here —
 * an erase would have taken every fee plan with it and left someone retyping
 * the price list before they could invoice anybody. Fee amounts are exactly
 * the thing you do not want re-entered from memory.
 *
 * NOT kept, deliberately: `auditLog` is a record of what happened to the demo
 * data and means nothing afterwards. `users` and `siteContent` never reach
 * this loop at all — see COLLECTIONS.
 */
export async function resetEverything({ safetyCopy = true, keepInstitute = true } = {}) {
    session.require(CAPABILITIES.DATA_RESTORE, 'erase all data');

    let safety = null;
    if (safetyCopy) {
        const current = await buildBackup({ note: 'Automatic safety copy taken before erasing everything' });
        if (current.totalRecords > 0) {
            downloadFile(`natyam-before-erase-${localDate()}.json`, JSON.stringify(current), 'application/json');
            safety = summarise(current);
        }
    }

    const kept = keepInstitute ? ['settings', 'branches', 'feePlans'] : [];
    const cleared = {};

    for (const { key, repo } of COLLECTIONS) {
        if (kept.includes(key)) continue;
        // replaceAll([]) is the erase: it is the same atomic path a restore
        // uses, so there is one code path that empties a collection rather
        // than two that could drift.
        const before = (await repo.all().catch(() => [])).length;
        await repo.replaceAll([]);
        cleared[key] = before;
    }

    const result = {
        cleared,
        collectionsCleared: Object.keys(cleared).length,
        recordsCleared: Object.values(cleared).reduce((a, b) => a + b, 0),
        kept,
        safety
    };

    bus.emit(EVENTS.BACKUP_RESTORED, result);
    return result;
}

/* ------------------------------------------------------------------ HELPERS */

function summarise(backup) {
    return {
        takenAt: backup.takenAt,
        takenBy: backup.takenBy,
        note: backup.note,
        totalRecords: backup.totalRecords,
        sections: Object.entries(backup.counts || {}).filter(([, n]) => n > 0).length
    };
}

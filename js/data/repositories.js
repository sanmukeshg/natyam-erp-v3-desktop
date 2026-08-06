/**
 * Natyam ERP v3 (Admin) — Entity repositories, re-exported.
 *
 * Unlike the reference project's repositories.js (which re-exports every
 * entity so nothing has to change when a store migrates), this file only
 * re-exports what this app's already-migrated modules actually import.
 * It grows in step with js/modules/, as each feature module is brought
 * over — see MIGRATION_CHECKLIST.md for what's here and why. Do not add a
 * re-export "for later"; add it when the module that needs it arrives.
 *
 * Current module set: Auth (Stage 0), Dashboard (Stage 1).
 * The Dashboard is an aggregate view, so its closure is unusually wide —
 * it reads from most collections even though most *screens* are not built
 * yet. That is the Dashboard's nature, not speculative copying.
 */

/* ---- Identity & org (Stage 0: auth) ---- */
export { users$, authMethodsOf } from './users.repository.firestore.js';
export { branches$ } from './branches.repository.firestore.js';
/* Academic years — Settings (Stage 12). Removed in Stage 3 as unreached; the
   Settings module is the one that genuinely needs it. */
export { academicYears$ } from './academicYears.repository.firestore.js';
export { audit$ } from './auditLog.repository.firestore.js';

/* ---- People (Stage 1: dashboard) ---- */
export { students$ } from './students.repository.firestore.js';
export { staff$, branchIdsOf } from './staff.repository.firestore.js';
export { admissions$ } from './admissions.repository.firestore.js';
export { drafts$ } from './drafts.repository.firestore.js';

/* ---- Teaching ---- */
export { batches$ } from './batches.repository.firestore.js';
export { classSessions$ } from './classSessions.repository.firestore.js';
export { attendance$, AttendanceMath } from './attendance.repository.firestore.js';
export { holidays$ } from './holidays.repository.firestore.js';
export { programs$ } from './programs.repository.firestore.js';
export { certificates$ } from './certificates.repository.firestore.js';

/* ---- Curriculum & records (Stage 3: students) ---- */
export { curricula$ } from './curricula.repository.firestore.js';
// Carried in Stage 26 solely so backups are COMPLETE. No v3 screen reads this
// collection yet — but it holds real records in Firestore, and a backup that
// silently omits a collection is worse than no backup: restoring it would
// quietly leave that data behind.
export { curriculumLevels$ } from './curriculumLevels.repository.firestore.js';
export { documents$ } from './documents.repository.firestore.js';

/* ---- Money ---- */
export { feePlans$ } from './feePlans.repository.firestore.js';
export { invoices$, InvoiceMath, deriveInvoiceStatus, reconcile } from './invoices.repository.firestore.js';
export { payments$, PaymentMath } from './payments.repository.firestore.js';
export { ledger$, LedgerMath } from './ledger.repository.firestore.js';
export { expenses$, ExpenseMath } from './expenses.repository.firestore.js';
export { salaries$ } from './salaries.repository.firestore.js';

/** Cross-collection ledger postings — see ledger.repository.firestore.js's header for why these live there. */
export {
    postPayment, postRefund, postExpenseCreate, postExpenseUpdate, postExpenseRemove, postPayroll
} from './ledger.repository.firestore.js';

/* ---- Platform ---- */
export { settings$ } from './settings.repository.firestore.js';
export { notifications$ } from './notifications.repository.firestore.js';

/* ---- Parent/Student Portal writes ----
   natyam-mobile writes both of these — an enquiry from the public site, a
   profile on every parent sign-in — and no v3 screen here reads either one
   yet. Carried for the same reason as curriculumLevels$ above: the Data tab's
   backup/export/erase tools have to see the whole database, and a backup or
   an erase that silently skips a collection is worse than admitting it does
   not have one. */
export { enquiries$ } from './enquiries.repository.firestore.js';
export { parentProfiles$ } from './parentProfiles.repository.firestore.js';

/* ---- Website Content ----
   The public-facing sections, written here and nowhere else in the product:
   natyam-mobile carries a read-only copy of this repository, and the future
   Natyam website will read the same documents. Everything in this collection
   is world-readable by design. */
export { siteContent$ } from './siteContent.repository.firestore.js';

/**
 * Natyam ERP v3 — Admin — Enquiries (Firestore)
 *
 * Read-and-erase only. No admin screen creates, triages or displays an
 * enquiry yet — that is Reception's future desk, still to be built — but the
 * collection is real, natyam-mobile writes to it today, and the Data tab's
 * backup/export/erase tools have to see the whole database or they are
 * quietly lying about what a backup contains. Same reasoning as
 * curriculumLevels$ in repositories.js: carried here solely so the Data tools
 * are complete, not because a feature needs it.
 *
 * `all()` and `replaceAll()` only, because those are the only two operations
 * backup.service.js performs — see students/holidays repositories for the
 * full CRUD shape a repository takes once this app has a screen that reads
 * and writes single records.
 *
 * No soft delete: natyam-mobile's writer never sets `deletedAt` on this
 * collection (spam is deleted outright, per its own repository's header), so
 * there is no visible/deleted split to filter here either.
 */

import {
    collection, doc, getDocs, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firestore } from '../core/firebase.js';

const COLLECTION_NAME = 'enquiries';
const enquiriesCollection = collection(firestore, COLLECTION_NAME);

export const enquiries$ = {
    async all() {
        const snap = await getDocs(enquiriesCollection);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    /**
     * RESTORE / ERASE USE ONLY (js/services/backup.service.js).
     *
     * Matches every other repository's replaceAll(): delete everything that
     * exists, then write back whatever was given — `[]` for an erase, a
     * backup's rows for a restore. Batched at 450 to stay under Firestore's
     * 500-operation transaction limit with room to spare.
     *
     * Restoring a PREVIOUSLY-TRIAGED enquiry (anything with a non-'new'
     * status, or handledBy/handledOn/note set) will be rejected by
     * firestore.rules' isPublicEnquiry() — that rule shape-locks `create` to
     * a fresh, untouched enquiry, which is correct for the public submitting
     * one and does not know an Administrator restore exists. Erasing
     * (`replaceAll([])`, pure delete) is unaffected: delete is
     * isAdministrator()-gated and every enquiry qualifies regardless of its
     * status.
     */
    async replaceAll(records) {
        const existing = await this.all();

        for (let i = 0; i < existing.length; i += 450) {
            const chunk = existing.slice(i, i + 450);
            const delBatch = writeBatch(firestore);
            for (const row of chunk) delBatch.delete(doc(firestore, COLLECTION_NAME, row.id));
            await delBatch.commit();
        }

        for (let i = 0; i < records.length; i += 450) {
            const chunk = records.slice(i, i + 450);
            const setBatch = writeBatch(firestore);
            for (const record of chunk) {
                const { id, ...data } = record;
                setBatch.set(doc(enquiriesCollection, id), data);
            }
            await setBatch.commit();
        }

        return records.length;
    }
};

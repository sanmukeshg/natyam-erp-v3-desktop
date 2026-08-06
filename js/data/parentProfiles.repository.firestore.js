/**
 * Natyam ERP v3 — Admin — Parent profiles (Firestore)
 *
 * Read-and-erase only, for the same reason enquiries.repository.firestore.js
 * in this app is: no admin screen reads a single parent profile yet, but the
 * collection is real, natyam-mobile writes to it on every parent sign-in, and
 * the Data tab's backup/export/erase tools have to see the whole database.
 *
 * `all()` and `replaceAll()` only — see natyam-mobile's copy of this file for
 * the write side (find/record), which belongs there because that is the app
 * a parent actually signs into.
 *
 * No soft delete: this collection has none — see natyam-mobile's copy.
 * Doc id is the parent's own lowercased email (keyFor() there), carried
 * straight through here as `record.id` since every row this app ever
 * touches came from all() first.
 */

import {
    collection, doc, getDocs, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firestore } from '../core/firebase.js';

const COLLECTION_NAME = 'parentProfiles';
const parentProfilesCollection = collection(firestore, COLLECTION_NAME);

export const parentProfiles$ = {
    async all() {
        const snap = await getDocs(parentProfilesCollection);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    /**
     * RESTORE / ERASE USE ONLY (js/services/backup.service.js).
     *
     * Same shape as every other repository's replaceAll(): delete everything,
     * then write back whatever was given.
     *
     * Restoring data back (a backup's rows, not an erase's `[]`) needs
     * firestore.rules' parentProfiles create rule to accept an Administrator
     * writing on a parent's behalf — it currently only accepts the profile's
     * own owner (isOwnDoc(profileId)), which an Administrator never is. See
     * this repository's sibling change in firestore.rules.
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
                setBatch.set(doc(parentProfilesCollection, id), data);
            }
            await setBatch.commit();
        }

        return records.length;
    }
};

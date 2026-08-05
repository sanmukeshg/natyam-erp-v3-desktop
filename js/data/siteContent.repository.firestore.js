/**
 * Natyam ERP v3 — Admin — Website content store (Firestore)
 *
 * The write side of /siteContent. One document per section, the section key
 * as the document id — the same shape as settings.repository.firestore.js,
 * and for the same reason: this is a small set of named values, not an entity
 * with an id, an audit trail and a soft delete.
 *
 * THIS IS THE ONLY PLACE PUBLIC CONTENT IS WRITTEN, anywhere in the product.
 * natyam-mobile carries a deliberately read-only copy of this repository; the
 * future Natyam website will read the same documents. If a second writer ever
 * appears, the single-source-of-truth property this whole module exists to
 * provide is gone.
 *
 * EVERYTHING HERE IS WORLD-READABLE. firestore.rules has
 * `allow read: if true` on this collection, because a prospective parent has
 * no account. Nothing that would not go on a public web page belongs in these
 * documents — there is no "draft" or "internal" field, and adding one would be
 * a mistake rather than a feature.
 *
 * The document shape is `{ value, updatedAt }`, pinned by firestore.rules'
 * isSiteContentEnvelope(), with the section's envelope inside `value`. Writes
 * need settings.edit; the service above enforces that client-side so the
 * person gets a sentence, and the rules enforce it for real.
 */

import {
    collection, doc, getDoc, getDocs, setDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firestore } from '../core/firebase.js';
import { session } from '../core/session.js';
import { nowISO } from '../utils/date.js';

const COLLECTION_NAME = 'siteContent';
const siteContentCollection = collection(firestore, COLLECTION_NAME);

export const siteContent$ = {
    /**
     * @param {string} key        A section key (see websiteContent.config.js).
     * @param {*} [fallback]      Returned when the section has never been saved.
     */
    async get(key, fallback = null) {
        const snap = await getDoc(doc(firestore, COLLECTION_NAME, key));
        return snap.exists() ? snap.data().value : fallback;
    },

    /** Every saved section, as `{ key, value, updatedAt }` rows. */
    async all() {
        const snap = await getDocs(siteContentCollection);
        return snap.docs.map((d) => ({ key: d.id, ...d.data() }));
    },

    /**
     * Writes one section whole.
     *
     * setDoc without merge, deliberately: a section IS its envelope, and a
     * merge would leave a paragraph the editor had just deleted sitting in the
     * document because nothing overwrote that array index. Replacing the whole
     * value is the only way "remove the third paragraph" can mean what it says.
     */
    async set(key, value) {
        // System-managed audit metadata, stamped here rather than passed in by
        // a caller — the point of it is that nobody can type it, forget it or
        // get it wrong.
        //
        // Deliberately OUTSIDE `value`. The envelope inside `value` is what
        // natyam-mobile and the future website read and render; anything put
        // there is public content. Sitting alongside it at document level
        // keeps this metadata off every public surface for free, with no
        // filtering needed at the other end — mobile's repository reads
        // `snap.data().value` and never sees these fields at all.
        //
        // firestore.rules' isSiteContentEnvelope() pins the document's key set,
        // so these three names are also fixed there and the two must agree.
        const record = {
            value,
            updatedAt: nowISO(),
            updatedBy: session.actorId(),
            updatedByName: session.actorName()
        };
        await setDoc(doc(firestore, COLLECTION_NAME, key), record);
        return record;
    },

    /**
     * Removes a section entirely, returning the public app to its "coming
     * soon" state for it. Distinct from saving an empty envelope, which would
     * publish a real but blank page.
     */
    async remove(key) {
        await deleteDoc(doc(firestore, COLLECTION_NAME, key));
        return true;
    }
};

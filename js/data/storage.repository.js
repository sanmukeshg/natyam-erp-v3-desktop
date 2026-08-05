/**
 * Natyam ERP v3 — Admin — Cloud Storage access
 *
 * The application's only file-storage repository, and the only file besides
 * js/core/firebase.js that imports the Storage SDK. It does exactly what every
 * other repository here does — data access, nothing else. What may be
 * uploaded, where it goes, how big it may be and what happens to the file it
 * replaces are all decisions, and decisions live in
 * js/services/upload.service.js.
 *
 * NOT a Firestore repository, despite sitting beside them — hence the plain
 * `.js` rather than the `.firestore.js` suffix the others carry. Cloud Storage
 * holds bytes at a path; Firestore holds documents. The only thing that
 * crosses between them is the download URL, which a service stores on a
 * Firestore document after an upload succeeds.
 *
 * A NOTE ON DOWNLOAD URLs. getDownloadURL() returns a long-lived, tokenised
 * https URL. It is unguessable but it is NOT a secret: anyone holding it can
 * fetch the object regardless of Storage rules. That is exactly right for
 * public website images, which is what this app uploads today — but it means
 * a future private scope (student photos, documents) must not treat "the URL
 * is hard to guess" as access control. Those get their own rules, and their
 * URLs must not be published anywhere a stranger can read them.
 */

import {
    ref, uploadBytesResumable, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';
import { storage } from '../core/firebase.js';

export const storage$ = {
    /**
     * Uploads one file and resolves to its download URL.
     *
     * uploadBytesResumable() rather than the simpler uploadBytes() for one
     * reason: it reports progress. A photo on a slow connection is exactly the
     * kind of wait that needs a bar rather than a frozen dialog, and the
     * resumable API is the only one that can supply it.
     *
     * @param {string} path              Full object path, built by the service.
     * @param {File|Blob} file
     * @param {object} [options]
     * @param {Function} [options.onProgress]  (percent: number) => void
     * @param {string} [options.contentType]
     * @returns {Promise<{path: string, url: string}>}
     */
    async put(path, file, { onProgress = null, contentType = null } = {}) {
        const task = uploadBytesResumable(ref(storage, path), file, {
            contentType: contentType || file.type || 'application/octet-stream'
        });

        await new Promise((resolve, reject) => {
            task.on('state_changed',
                (snap) => {
                    if (!onProgress || !snap.totalBytes) return;
                    onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
                },
                reject,
                resolve);
        });

        return { path, url: await getDownloadURL(task.snapshot.ref) };
    },

    /**
     * Removes one object.
     *
     * `storage/object-not-found` is swallowed deliberately: every caller
     * deletes a file it believes exists, and the one case where it does not —
     * a half-finished upload, a file already removed, a record edited twice —
     * should not turn into an error the user has to read. Any other failure
     * (permission, network) still propagates.
     */
    async remove(path) {
        try {
            await deleteObject(ref(storage, path));
            return true;
        } catch (err) {
            if (err?.code === 'storage/object-not-found') return true;
            throw err;
        }
    }
};

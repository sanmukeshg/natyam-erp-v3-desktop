/**
 * Natyam ERP v3 — Admin — File upload service
 *
 * The application's standard way to put a file somewhere and get a URL back.
 * Website Content is its first caller; Student Photos, Certificates, Gallery,
 * Events, Documents and Profile Photos are meant to be later ones, which is
 * why nothing below knows anything about website content specifically.
 *
 * A CALLER NEVER NAMES A PATH. It names a SCOPE — a declared kind of upload —
 * and this service decides where the bytes land, what may be uploaded there
 * and how large it may be. That is the whole point of the indirection: paths
 * are also what storage.rules gates on, so a page that could invent its own
 * path could write outside the rule that was written for it.
 *
 * ADDING A SCOPE is one entry in SCOPES below plus one matching block in
 * storage.rules. No new function, no new repository method. The two must be
 * added together — a scope with no rule fails every upload with
 * "storage/unauthorized", and a rule with no scope is dead configuration.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: image resizing, cropping or format
 * conversion. Those need either a Cloud Function or a canvas pipeline, and
 * neither is worth building before anyone has complained about a large photo.
 * The size cap is the crude version of that protection, and it is enough for
 * a school publishing a handful of pictures.
 */

import { storage$ } from '../data/storage.repository.js';

/**
 * Every declared kind of upload. `prefix` is the first path segment and is
 * what storage.rules matches on.
 *
 * Only WEBSITE_CONTENT exists today. The commented shapes are not
 * placeholders to fill in speculatively — they record the intended path
 * layout so the next person adds a scope in the same shape rather than
 * inventing a competing one.
 *
 *   websiteContent/{sectionKey}/{file}   public read   settings.edit write
 *
 * Later, each with its own storage.rules block:
 *   students/{studentId}/{file}          staff + that student's guardian
 *   certificates/{certificateId}/{file}  staff + that student's guardian
 *   documents/{ownerType}/{ownerId}/…    staff only
 *   profiles/{userId}/{file}             the user themselves, and staff
 */
export const UPLOAD_SCOPES = Object.freeze({
    WEBSITE_CONTENT: 'websiteContent'
});

const IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

/**
 * SVG is absent from IMAGE_TYPES on purpose, and it is not an oversight to
 * "fix" later: an SVG is a document that can carry script, and these files are
 * served from the project's own storage domain and rendered on a public page.
 * JPEG, PNG and WebP cannot execute anything.
 */
const SCOPES = Object.freeze({
    [UPLOAD_SCOPES.WEBSITE_CONTENT]: Object.freeze({
        prefix: 'websiteContent',
        accept: IMAGE_TYPES,
        maxBytes: 5 * 1024 * 1024,
        what: 'image'
    })
});

/* ==========================================================================
   VALIDATION
   ========================================================================== */

function scopeOrFail(scope) {
    const config = SCOPES[scope];
    if (!config) throw new Error(`Unknown upload scope "${scope}".`);
    return config;
}

function megabytes(bytes) {
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Checks a file before a byte leaves the browser. Messages are written for
 * the person choosing the file, not for a developer — "That image is 8.4 MB"
 * tells them what to do next; "validation failed" does not.
 */
export function validateFile(scope, file) {
    const config = scopeOrFail(scope);

    if (!file) return 'Choose a file first.';

    if (!config.accept.includes(file.type)) {
        const names = config.accept.map((t) => t.replace('image/', '').toUpperCase()).join(', ');
        return `That file is not a supported ${config.what}. Use ${names}.`;
    }

    if (file.size > config.maxBytes) {
        return `That ${config.what} is ${megabytes(file.size)}. The limit is `
            + `${megabytes(config.maxBytes)} — please use a smaller version.`;
    }

    if (file.size === 0) return 'That file is empty.';

    return null;
}

/**
 * A storage-safe, collision-proof object name.
 *
 * The timestamp prefix is what prevents collisions, and it also means a
 * replaced image never overwrites its predecessor in place — the old object
 * is deleted explicitly instead, so a failed delete leaves an orphan rather
 * than a broken link on a live public page.
 *
 * The original name is kept (sanitised) rather than discarded, because
 * "1754400000000-founder-portrait.jpg" is something a person can recognise in
 * the Firebase console and "1754400000000" is not.
 */
function objectName(file) {
    const original = String(file.name || 'file');
    const dot = original.lastIndexOf('.');
    const stem = (dot > 0 ? original.slice(0, dot) : original)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'file';
    const ext = (dot > 0 ? original.slice(dot + 1) : '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 5) || 'bin';

    return `${Date.now()}-${stem}.${ext}`;
}

/* ==========================================================================
   UPLOAD
   ========================================================================== */

/**
 * Uploads a file into a scope.
 *
 * @param {string} scope             One of UPLOAD_SCOPES.
 * @param {object} options
 * @param {string} options.ownerId   What the file belongs to — a section key
 *   for website content, a studentId for a photo. Becomes a path segment, so
 *   it is sanitised rather than trusted.
 * @param {File} options.file
 * @param {Function} [options.onProgress]  (percent: number) => void
 * @param {string} [options.replaces]      Storage path of the file this one
 *   supersedes. Deleted only after the new upload succeeds.
 * @returns {Promise<{path: string, url: string}>} `url` goes on the record;
 *   `path` must be stored alongside it, or the file can never be deleted.
 */
export async function upload(scope, { ownerId, file, onProgress = null, replaces = null }) {
    const config = scopeOrFail(scope);

    const problem = validateFile(scope, file);
    if (problem) throw new Error(problem);

    const owner = String(ownerId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    if (!owner) throw new Error('An upload needs to belong to something.');

    const path = `${config.prefix}/${owner}/${objectName(file)}`;

    const result = await storage$.put(path, file, { onProgress, contentType: file.type })
        .catch((err) => { throw new Error(friendlyStorageError(err)); });

    // Only after the replacement is safely stored. Doing it first would leave
    // the record pointing at nothing if the upload then failed — and a failure
    // to delete the old file is an orphaned object nobody sees, which is far
    // cheaper than a missing image on a live public page.
    if (replaces && replaces !== result.path) {
        await storage$.remove(replaces).catch((err) =>
            console.error(`Uploaded the new file but could not remove the old one (${replaces})`, err));
    }

    return result;
}

/**
 * Removes an uploaded file — clearing an image rather than replacing it.
 * Absent objects are treated as already gone (see storage.repository.js).
 */
export async function remove(path) {
    if (!path) return true;
    return storage$.remove(path).catch((err) => { throw new Error(friendlyStorageError(err)); });
}

/**
 * Storage SDK errors are codes, not sentences. These are the ones this app can
 * actually produce; anything else falls back to a plain message rather than
 * showing a person a raw `storage/...` code.
 */
function friendlyStorageError(err) {
    switch (err?.code) {
        case 'storage/unauthorized':
            return 'You do not have permission to upload here. This needs Settings access.';
        case 'storage/canceled':
            return 'The upload was cancelled.';
        case 'storage/quota-exceeded':
            return 'The storage quota is full. An administrator needs to free space or raise the limit.';
        case 'storage/retry-limit-exceeded':
        case 'storage/unknown':
            return 'The upload did not complete — check your connection and try again.';
        case 'storage/unauthenticated':
            return 'Your session has expired. Sign in again and retry.';
        default:
            return err?.message || 'The upload failed.';
    }
}

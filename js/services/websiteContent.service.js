/**
 * Natyam ERP v3 — Admin — Website Content service
 *
 * The business layer behind Settings → Website Content. It turns what the
 * editor holds — a title, some paragraphs, a list of branches — into the
 * envelope /siteContent stores, and back again.
 *
 * WHY A TRANSLATION LAYER AT ALL, rather than editing the envelope directly:
 * the stored shape is generic on purpose, so that one renderer in the mobile
 * app and one in the future website can handle every section including the
 * ones nobody has designed yet. That genericity is right for a consumer and
 * wrong for a person: nobody should be asked to think in blocks and facts
 * arrays to type a phone number. websiteContent.config.js declares the
 * friendly form, and this file maps between the two.
 *
 * EVERY SAVE IS A WHOLE SECTION. There is no partial update — see
 * siteContent.repository.firestore.js's set() for why a merge cannot express
 * "I deleted that paragraph".
 *
 * NOTHING IS SANITISED FOR DISPLAY HERE. The mobile app's
 * publicContent.service.js rebuilds every field it renders and drops anything
 * it does not recognise; that is the read-side guard and it stays the guard
 * regardless of what this writes. What this file does is validate for the
 * PERSON — required fields, sane lengths — so a mistake is caught while they
 * can still fix it.
 */

import { session } from '../core/session.js';
import { siteContent$ } from '../data/repositories.js';
import {
    SECTIONS, CONTENT_KINDS, BLOCK_TYPES, sectionFor, WEBSITE_CONTENT_CAPABILITY
} from '../config/websiteContent.config.js';
import { remove as removeUpload } from './upload.service.js';

/* ==========================================================================
   READ
   ========================================================================== */

/** Every section, each with its stored envelope (or an empty one). */
export async function listSections() {
    const rows = await siteContent$.all();
    const stored = new Map(rows.map((r) => [r.key, r]));

    return SECTIONS.map((section) => {
        const row = stored.get(section.key) || null;
        return {
            section,
            envelope: row?.value || emptyEnvelope(section),
            published: Boolean(row),
            // System-managed audit metadata. Surfaced to this module only —
            // it is deliberately never returned to the mobile app or the
            // website, which read `value` and nothing else.
            updatedAt: row?.updatedAt || null,
            updatedBy: row?.updatedBy || null,
            updatedByName: row?.updatedByName || null
        };
    });
}

export async function loadSection(key) {
    const section = sectionFor(key);
    if (!section) throw new Error(`Unknown website content section "${key}".`);
    const value = await siteContent$.get(key, null);
    return {
        section,
        envelope: value || emptyEnvelope(section),
        published: Boolean(value)
    };
}

function emptyEnvelope(section) {
    return section.kind === CONTENT_KINDS.LIST
        ? { kind: CONTENT_KINDS.LIST, title: '', subtitle: '', items: [] }
        : { kind: CONTENT_KINDS.PAGE, title: '', subtitle: '', blocks: [] };
}

/* ==========================================================================
   THE FRIENDLY FORM ↔ THE STORED ENVELOPE
   ========================================================================== */

const text = (v, max = 4000) => String(v ?? '').trim().slice(0, max);

/**
 * Reads one declared field off an item. `path` fields are item properties;
 * `fact` fields live as a labelled row in the item's facts table.
 */
export function readField(item, field) {
    if (field.path) return item?.[field.path] ?? '';
    const row = (item?.facts || []).find((f) => f.label === field.fact);
    return row?.value ?? '';
}

/** Builds a stored item from the values the form collected. */
export function buildItem(section, values, existing = null) {
    const item = {
        id: existing?.id || `i${Date.now().toString(36)}`,
        title: '', subtitle: '', body: '', image: '', facts: []
    };

    // The image is not a form field — it is uploaded separately — so it is
    // carried across from the existing item rather than read from `values`.
    if (existing?.image) item.image = existing.image;
    if (existing?.imagePath) item.imagePath = existing.imagePath;

    for (const field of section.fields || []) {
        const value = text(values[fieldName(field)], field.max || 1000);
        if (field.path) item[field.path] = value;
        else if (value) item.facts.push({ label: field.fact, value });
    }

    return item;
}

/** A stable form-input name for a declared field. */
export function fieldName(field) {
    return field.path ? `p_${field.path}` : `f_${field.fact.replace(/\W+/g, '_')}`;
}

/** Validates one item against its section's declared fields. */
export function validateItem(section, values) {
    const errors = {};
    for (const field of section.fields || []) {
        const value = text(values[fieldName(field)], (field.max || 1000) + 1);
        if (field.required && !value) errors[fieldName(field)] = `${field.label} is required.`;
        else if (field.max && value.length > field.max) {
            errors[fieldName(field)] = `${field.label} can be at most ${field.max} characters.`;
        }
    }
    return { ok: Object.keys(errors).length === 0, errors };
}

/* ==========================================================================
   WRITE
   ========================================================================== */

/**
 * Saves a section.
 *
 * The capability is required here as well as in firestore.rules — the rules
 * are the boundary that cannot be bypassed, and this check is what turns a
 * refusal into a sentence instead of a "Missing or insufficient permissions"
 * crash halfway through a form.
 */
export async function saveSection(key, envelope) {
    session.require(WEBSITE_CONTENT_CAPABILITY, 'edit website content');

    const section = sectionFor(key);
    if (!section) throw new Error(`Unknown website content section "${key}".`);

    const clean = section.kind === CONTENT_KINDS.LIST
        ? {
            kind: CONTENT_KINDS.LIST,
            title: text(envelope.title, 200),
            subtitle: text(envelope.subtitle, 300),
            items: (envelope.items || []).map((it) => ({
                id: text(it.id, 64),
                title: text(it.title, 200),
                subtitle: text(it.subtitle, 300),
                body: text(it.body, 4000),
                image: text(it.image, 500),
                ...(it.imagePath ? { imagePath: text(it.imagePath, 500) } : {}),
                facts: (it.facts || [])
                    .map((f) => ({ label: text(f.label, 80), value: text(f.value, 200) }))
                    .filter((f) => f.label && f.value)
            }))
        }
        : {
            kind: CONTENT_KINDS.PAGE,
            title: text(envelope.title, 200),
            subtitle: text(envelope.subtitle, 300),
            blocks: (envelope.blocks || []).map(cleanBlock).filter(Boolean)
        };

    await siteContent$.set(key, clean);
    return clean;
}

function cleanBlock(block) {
    switch (block?.type) {
        case BLOCK_TYPES.HEADING:
            return block.text?.trim() ? { type: block.type, text: text(block.text, 200) } : null;
        case BLOCK_TYPES.TEXT:
            return block.text?.trim() ? { type: block.type, text: text(block.text, 4000) } : null;
        case BLOCK_TYPES.IMAGE:
            // `imagePath` is the Storage object path and is kept so the file
            // can be deleted when it is replaced or cleared. The mobile app's
            // normaliser drops it — it is bookkeeping, not content.
            return block.src
                ? {
                    type: block.type,
                    src: text(block.src, 500),
                    ...(block.imagePath ? { imagePath: text(block.imagePath, 500) } : {}),
                    alt: text(block.alt, 200),
                    caption: text(block.caption, 300)
                }
                : null;
        case BLOCK_TYPES.FACTS: {
            const facts = (block.facts || [])
                .map((f) => ({ label: text(f.label, 80), value: text(f.value, 200) }))
                .filter((f) => f.label && f.value);
            return facts.length ? { type: block.type, facts } : null;
        }
        default:
            return null;
    }
}

/**
 * Unpublishes a section — the public app returns it to "coming soon".
 *
 * Any images it held are removed from Storage first. Deleting the document
 * alone would orphan them: nothing would reference the files, and nothing
 * would ever clean them up. Image removal is best-effort, because a leftover
 * file is a smaller problem than a section that refuses to unpublish.
 */
export async function unpublishSection(key) {
    session.require(WEBSITE_CONTENT_CAPABILITY, 'remove website content');

    const value = await siteContent$.get(key, null);
    for (const path of imagePathsIn(value)) {
        await removeUpload(path).catch((err) =>
            console.error(`Could not remove ${path} while unpublishing "${key}"`, err));
    }

    await siteContent$.remove(key);
    return true;
}

/** Every Storage object path referenced by a stored envelope. */
export function imagePathsIn(envelope) {
    if (!envelope) return [];
    const fromBlocks = (envelope.blocks || []).map((b) => b.imagePath).filter(Boolean);
    const fromItems = (envelope.items || []).map((i) => i.imagePath).filter(Boolean);
    return [...fromBlocks, ...fromItems];
}

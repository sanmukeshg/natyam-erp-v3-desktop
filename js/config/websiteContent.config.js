/**
 * Natyam ERP v3 — Admin — Website Content: sections and their forms
 *
 * Settings → Website Content is the single place every public-facing section
 * is written. It feeds /siteContent, which natyam-mobile reads today and the
 * Natyam website will read later.
 *
 * THIS FILE IS THE EDITOR. There is no per-section screen and there must not
 * be one: the panel renders whatever is declared below, so adding Gallery,
 * Events, FAQ, Contact, Testimonials, Website Home or SEO later is an entry
 * here plus the matching entry in natyam-mobile's publicContent.config.js —
 * no new form, no new save path, no rules change.
 *
 * TWO KINDS, matching the stored envelope exactly (see natyam-mobile's
 * publicContent.config.js, which documents the schema both apps share):
 *
 *   PAGE  Prose. Title, subtitle, an ordered run of paragraphs, an optional
 *         key-facts table, and — where `allowImage` — one picture.
 *
 *   LIST  Repeating entries. Title and intro, then items whose fields are
 *         declared per section, so a Branch form asks for an address and a
 *         Batch Timing form asks for days and times.
 *
 * FRIENDLY LABELS, GENERIC STORAGE. A field either maps to an item property
 * (`path`) or to a row in that item's `facts` table (`fact`). The person
 * editing sees "Phone"; the document stores
 * `facts: [{ label: 'Phone', value: '…' }]`, which is what both the mobile app
 * and the future website already know how to render.
 *
 * OPERATIONAL DATA IS NOT MIRRORED HERE. Courses, Branches and Batch Timings
 * also exist as ERP records, and this module is deliberately independent of
 * them — the school maintains public copy by hand, in exchange for an
 * architecture with one moving part. That is also why a Batch Timing here can
 * say "Saturdays, 9–10:30am, all Foundation levels" when the underlying
 * batches are split three ways: this is a public description, not a mirror.
 */

import { CAPABILITIES } from './app.config.js';

export const CONTENT_KINDS = Object.freeze({ PAGE: 'page', LIST: 'list' });

export const BLOCK_TYPES = Object.freeze({
    HEADING: 'heading',
    TEXT:    'text',
    IMAGE:   'image',
    FACTS:   'facts'
});

/** Every section this module manages, in the order the editor lists them. */
export const SECTIONS = Object.freeze([
    Object.freeze({
        key: 'about',
        kind: CONTENT_KINDS.PAGE,
        label: 'About Natyam',
        help: 'The school’s own description of itself. Shown first in the app.',
        titleLabel: 'Heading',
        titlePlaceholder: 'About Natyam',
        subtitleLabel: 'Tagline',
        subtitlePlaceholder: 'Preserving the Legacy of Kuchipudi',
        paragraphLabel: 'Paragraph',
        factsLabel: 'Key facts',
        factHint: 'Short pairs such as Founded / 2009. Leave empty if not needed.',
        allowImage: false
    }),

    Object.freeze({
        key: 'courses',
        kind: CONTENT_KINDS.LIST,
        label: 'Courses',
        help: 'The graded syllabus as a parent should see it. Name and code only for now.',
        titleLabel: 'Heading',
        titlePlaceholder: 'Courses',
        subtitleLabel: 'Intro text',
        subtitlePlaceholder: 'Kuchipudi at Natyam is taught as a graded syllabus.',
        itemLabel: 'Course',
        fields: [
            { path: 'title', label: 'Course name', required: true, max: 200, placeholder: 'Foundation Level 1' },
            { fact: 'Course code', label: 'Course code', max: 200, placeholder: 'foundation-1' }
        ]
    }),

    Object.freeze({
        key: 'branches',
        kind: CONTENT_KINDS.LIST,
        label: 'Branches',
        help: 'Where classes run, and how a family can reach each one.',
        titleLabel: 'Heading',
        titlePlaceholder: 'Branches',
        subtitleLabel: 'Intro text',
        subtitlePlaceholder: 'Classes run at the branches below.',
        itemLabel: 'Branch',
        fields: [
            { path: 'title', label: 'Branch name', required: true, max: 200, placeholder: 'Natyam — Kondapur' },
            { path: 'subtitle', label: 'Address', type: 'textarea', max: 300 },
            { fact: 'Phone', label: 'Phone', max: 200, placeholder: '+91…' },
            { fact: 'Email', label: 'Email', max: 200 }
        ]
    }),

    Object.freeze({
        key: 'batchTimings',
        kind: CONTENT_KINDS.LIST,
        label: 'Batch Timings',
        help: 'Public class timings. Write these for parents — they need not match batch records one for one.',
        titleLabel: 'Heading',
        titlePlaceholder: 'Batch Timings',
        subtitleLabel: 'Intro text',
        subtitlePlaceholder: 'Confirm the current schedule when you enquire.',
        itemLabel: 'Timing',
        fields: [
            { path: 'title', label: 'Batch name', required: true, max: 200, placeholder: 'Foundation — Saturday morning' },
            { path: 'subtitle', label: 'Branch', max: 200, placeholder: 'Kondapur' },
            { fact: 'Days', label: 'Days', max: 200, placeholder: 'Saturday & Sunday' },
            { fact: 'Time', label: 'Time', max: 200, placeholder: '9:00 AM – 10:30 AM' },
            { path: 'body', label: 'Note', type: 'textarea', max: 1000 }
        ]
    }),

    Object.freeze({
        key: 'founder',
        kind: CONTENT_KINDS.PAGE,
        label: 'Founder',
        help: 'The teacher behind the school.',
        titleLabel: 'Name',
        titlePlaceholder: 'Founder’s name',
        subtitleLabel: 'Role',
        subtitlePlaceholder: 'Founder & Artistic Director',
        paragraphLabel: 'Biography paragraph',
        factsLabel: 'Key facts',
        factHint: 'Optional — training, honours, years teaching.',
        allowImage: true,
        imageLabel: 'Portrait'
    })
]);

/** Writing public content is the same capability that governs the school's
 *  own details — Administrator and Owner. Mirrors /siteContent's rule. */
export const WEBSITE_CONTENT_CAPABILITY = CAPABILITIES.SETTINGS_EDIT;

export function sectionFor(key) {
    return SECTIONS.find((s) => s.key === key) || null;
}

# Changelog — Natyam ERP v3 (Admin)

All notable changes to the desktop application.

This changelog starts at **3.0.0**, not at the reference project's 2.26.5. v3 is not a
continuation of that codebase in place — it is a new application, built by splitting
`Natyam-ERP-UAT` into two independent repositories and redesigning the desktop surface. The
reference project's own history remains where it is; nothing was moved out of it.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning is
[semantic](https://semver.org/).

---

## [3.2.0] — unreleased

Second UAT round. Every desktop item in
`Bugs_and_Enhancements_v3_Mobile and Desktop - Round 2.docx`.

### Changed

- **Reports is no longer a separate navigation item** (ENH-202). It is a section of Analytics,
  reached by a tab strip on that page. The entry stays in `NAVIGATION` marked `hidden` because
  `ROUTES` is derived from that list — removing it outright would unregister the route. The path
  moved to `/analytics/reports` so the shell's existing prefix match lights up Analytics while
  Reports is open, with no special case in `markActive()`.

### Fixed

- **The sidebar collapse button did not say which way it goes** (BUG-207). It kept pointing left
  once collapsed, reading as "collapse further". The glyph now follows the state, and the button
  is repainted on toggle rather than only at mount — `mount()` draws it once, so setting the
  `data-rail` attribute alone left the icon and the accessible name describing the state the
  sidebar was in when the shell was built. Added `chevrons-right` to the icon set, and centred
  the toggle in the 64px rail where it was pinned right by `margin-left: auto`.

## [3.1.0] — unreleased

First UAT round. Every item in `Bugs_and_Enhancements_v3_Desktop.docx`, which was the
sole source of truth for this round — no undocumented changes.

### Added

- **Master data is editable** (BUG-001). Branches, Fee plans, Curriculum and Users could all
  be created but never edited, so a typo in a branch code or a fee amount was permanent. Each
  editor reuses its create field list, seeded from the record, and hands the whole set to the
  service — which keeps owning validation. Editing a fee plan reports how many students are
  billed against it; a curriculum entry's stored value is shown read-only, because existing
  records point at it.
- **Programme cast filters** (ENH-003). The cast picker offered 158 students in one flat list.
  It now filters by branch and batch, and ticks made outside the current filter are preserved
  and merged back on submit, so narrowing to one batch cannot silently drop another.
- **Form layer: value-dependent fields** (`js/ui/form.js`). `options` may now be a function
  of the form's current values, paired with `reactive: true` on the field being chosen from;
  `readonly` is also supported. Added for ENH-003 rather than special-casing one dialog.

### Fixed

- **Action buttons sat below the page title** on Staff, Programmes, Certificates, Finance,
  Analytics, Reports and Profile (ENH-001, ENH-004, ENH-005). All seven used
  `v3-page-head` — which only sets padding — instead of the established
  `v3-page-head-row`. One wrong class, seven symptoms.
- **Stacked blocks touched each other** on Fees and Finance (BUG-002, BUG-003).
  `.v3-page-body` spaces only its *direct* children, and both pages nest several blocks
  inside one wrapper. Those wrappers now carry the same `--space-4` rhythm as every other
  screen.
- **Timetable legend was unreadable** (ENH-002). "Upcoming" and "Cancelled" rendered the same
  colour. Both now have their own token; all five states are distinct. The strike-through on
  cancelled sessions is unchanged.
- **Conditional attributes rendered as text.** `html`` escapes its interpolated values, so
  `data-reactive="true"` was being painted as visible text rather than becoming an attribute
  — ENH-003's filters never fired. Emitted through `raw()`. Found while verifying, not
  reported.

## [3.0.0] — unreleased

The desktop half of the v3 split. **Not yet feature-complete** — see
`MIGRATION_CHECKLIST.md` for exactly which modules have migrated and which have not.

### Added

- **Independent application.** `natyam-admin` is its own repository, its own deployable, and
  its own PWA manifest. It shares the Firebase project (`natyam-erp`), Firestore collections,
  security rules, authentication, roles and data model with `natyam-mobile`, and nothing else.
- **v3 design layer** (`assets/css/v3.css`) — warm glass over the school's terracotta stage
  artwork, implemented from the approved Claude Design project. Two variants, wired to the
  existing `[data-theme]` preference. `tokens.css` is untouched and still supplies the type
  scale, spacing grid, radii, motion and z-index.
- **Redesigned navigation** — the sidebar is now a collapsible accordion: one group open at a
  time, auto-opening the group containing the current route, with a 64px icon rail and an
  in-sidebar jump filter. Same five groups, same routes, same capability gating as v2.
- **Redesigned Dashboard** — KPI strip, Needs attention, Today, Money, The roll, Recent
  activity.
- **Redesigned Students** — the roll is a compact card list (not v2's data table), and the
  student profile is a centred modal (not v2's right-side drawer).
- **Role gate at sign-in.** Desktop serves Administrator, Owner & Accountant and Viewer.
  Teacher & Reception is mobile-primary and is turned away with an explanation.
- **Small-screen notice.** Under 620px the app says plainly that this is the desktop
  application and points at the mobile one, rather than silently serving a squeezed layout.
- **`tools/verify-imports.cjs`** — a static import checker. With no build step, nothing else
  validates the module graph before a browser hits it.

### Changed

- **Navigation is no longer shared configuration.** `NAVIGATION`/`ROUTES` were removed from
  `app.config.js`; each app now owns its own table. Permission logic is still shared, through
  the same `CAPABILITIES` and `ROLES`.
- **`repositories.js` re-exports only what this app imports**, rather than every entity.

### Removed

- The guardian Parent/Student Portal, which belongs to `natyam-mobile`.
- IndexedDB (`js/core/db.js`, `js/core/repository.js`, `seed.js`, `js/data/archive/`). Every
  collection this app uses is Firestore-only; the old base class backed only the archived
  IndexedDB repositories.
- `js/ui/palette.js` — the design replaces the Ctrl-K command palette with the sidebar's own
  jump filter.
- `assets/css/components.css` — not yet needed. Neither redesigned module uses a table, which
  is what would have pulled it in.

### Known gaps

- Attendance, Admissions, Settings, Timetable, Fees, Finance, Reports, Analytics, Programmes,
  Certificates, Staff, Parents, Notifications and Profile are **not migrated**. Their sidebar
  entries render and route to an honest placeholder rather than being hidden.
- Student profile operations (Move batch, Collect fee, Promote, Status, Issue certificate) and
  Add/Edit student are drawn per the design but disabled — each needs its own form or confirm
  flow, and several depend on modules that have not migrated.
- Nothing has been verified against a real signed-in session for every screen; see
  `MIGRATION_CHECKLIST.md` for what was and was not confirmed at each stage.

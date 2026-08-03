# Changelog — Natyam ERP v3 (Admin)

All notable changes to the desktop application.

This changelog starts at **3.0.0**, not at the reference project's 2.26.5. v3 is not a
continuation of that codebase in place — it is a new application, built by splitting
`Natyam-ERP-UAT` into two independent repositories and redesigning the desktop surface. The
reference project's own history remains where it is; nothing was moved out of it.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning is
[semantic](https://semver.org/).

---

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

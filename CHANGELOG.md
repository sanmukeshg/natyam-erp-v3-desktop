# Changelog — Natyam ERP v3 (Admin)

All notable changes to the desktop application.

This changelog starts at **3.0.0**, not at the reference project's 2.26.5. v3 is not a
continuation of that codebase in place — it is a new application, built by splitting
`Natyam-ERP-UAT` into two independent repositories and redesigning the desktop surface. The
reference project's own history remains where it is; nothing was moved out of it.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning is
[semantic](https://semver.org/).

---

## [3.6.0] — unreleased

Two features that were built everywhere except the one place someone could use them. Both
land in `natyam-admin` and `natyam-mobile`.

### Added

- **Declare a holiday** — Settings → Holidays, a new tab beside Branches. The repository, the
  dashboard day board, Backup & restore and the `holidayReminders` Cloud Function were all
  written and all working; nothing could create a row, so the collection was permanently empty
  and every one of those readers read nothing.
- **`js/services/holidays.service.js`**, byte-identical with `natyam-mobile`. Gated on
  `settings.edit`. Upcoming and past are returned separately, past capped at 400 days. The
  repository needed no changes at all.
- **Branch-scoped holidays** — one site closed while the others stay open, which the reads
  already honoured and nothing could express.
- **Post an announcement** — a button on the Notifications screen, gated on `settings.edit`.
  `announce()` has been complete in `notifications.service.js` since the module was written
  and **had no caller anywhere in either app**. This is the caller; the service is untouched.

### Changed

- **A holiday does not cancel classes**, and the screen says so. Milestone 6 deliberately
  decoupled attendance from holidays; cancelling a class stays a deliberate act in Timetable.
- **`firestore.rules`: holidays are writable.** The block was `create, update, delete: if
  false`. Now `create, update` on `canManageSettings()`, hard `delete` Administrator-only for
  `replaceAll()` during a restore, matching branches. **Needs publishing by hand.**

---

## [3.5.1] — 2026-08-08

### Changed

- **Guardian email is mandatory on the admission form's applicant step.** The field was
  already required by `studentFields.js` everywhere a student record is created or edited, but
  the admission form itself still treated it as optional — so an application could be approved
  into a student record that then failed its own validation on the next edit. Desktop and
  mobile carry the identical rule, in the shared `admissions.service.js`.

The icon work in the mobile 3.5.1 is deliberately not mirrored here: the desktop surface uses
its own `.v3-` classes and was not audited.

---

## [3.5.0] — 2026-08-08

UAT Round 6. All four items — BUG-601, BUG-602, ENH-601 and ENH-602 — land in both apps,
because all four change a workflow rather than a screen.

### Added

- **`js/config/studentFields.js` — one definition of the student record** (ENH-602). The
  student form's fields, and which of them are mandatory, are declared once and built from
  three places: Add student, Edit student, and the Admissions enrol step. Byte-identical in
  `natyam-mobile` and `natyam-admin`. There were three separate declarations before this, and
  they disagreed — the same child got a different record depending on which screen they were
  entered on.
- **The mandatory set, stated in one place**: name, branch, level, batch, fee plan, guardian
  name, guardian phone, guardian email. Enforced identically on Add, Edit and Enrolment, with
  the same wording on every message.
- **`enrolApplicant()` accepts the collected student record** (`options.student`), applied
  through a named whitelist (`ENROLLED_STUDENT_DETAILS`). Called without it, it behaves
  exactly as before.

### Changed

- **Enrolling a parent application collects the whole student record, in one step**
  (BUG-601). Enrol used to ask three questions — branch, batch, fee plan — and copy
  everything else off the application. A family application carries no address, no emergency
  contact and no medical note, so the student was created incomplete and the Owner had to open
  Student Management → Edit student immediately afterwards to finish it. Enrol now opens the
  full student form, pre-filled from the application, and the read-only confirmation still
  restates branch, batch and fee plan before anything is written.
- **Changing a student's branch now requires a batch at the new branch** (BUG-602). The batch
  list follows the Branch field, and a batch belonging to another branch is refused by name
  ("That batch is at another branch"). Saving is blocked until a valid one is chosen, so a
  student can no longer end up in one branch attached to a class in another.
- **Batch is mandatory when editing a student**, not only when adding one (BUG-602). It was
  optional on edit on both apps, which is how a branch change could clear it silently. Taking
  an attending student off every batch is no longer possible from any screen — see the
  invariant below.
- **The Staff module is Owner and Administrator only** (ENH-601). `staff.view` is no longer
  granted to Teacher & Reception or to Viewer, so the Staff entry disappears from the menu and
  the dashboard, and the router refuses `/staff` typed into the address bar. Teacher names on
  Batches, Timetable, Attendance and Programmes are unaffected — those read a name, not the
  staff module, and the Firestore read rule is deliberately unchanged for that reason.

### Fixed

- **A guardian's email typed at enrolment is stored lowercase and trimmed**, as it already was
  on every other path into a student record. `guardianAuth.service.js` matches a signed-in
  parent with an exact-equality query against the lowercase address Firebase returns, so
  "Priya@Gmail.com" would have signed in and been told she had no children at the school.

### Added — the invariant

- **`MANDATORY_STUDENT_FIELDS` is now the authority, not documentation** (ENH-602, revised).
  No field declaration carries its own `required:` or `label:` any more — both are derived from
  that one array and from `FIELD_LABELS`. Changing what the ERP demands of a student record is
  a one-line edit that lands on Desktop Add, Desktop Edit, Mobile Add, Mobile Edit and Parent
  Enrolment in the same commit, with nothing else able to hold a second opinion.
- **`assertMandatoryStudentFields()` — the same rule enforced in the service layer.**
  `enrol()`, `updateStudent()` and `enrolApplicant()` all call it, so a workflow that renders
  no form — a bulk operation, an import, a screen written next year — cannot get past it
  either. The message is the same sentence a form would have shown.
- **`tools/verify-shared.cjs`** — checks the byte-identical shared files (the student field
  config, four services, `firestore.rules`) against the sibling repository, so "identical by
  convention" is checkable in one command rather than by memory. Compares content with line
  endings normalised, and skips cleanly when no sibling checkout exists.

### Changed — no active student without a batch

The rule behind BUG-602 ("a student must never exist without a valid batch") was only ever
enforced by whichever form happened to be open. Four service paths could break it with no form
involved, and one of them did so on **every** use:

- **Promotion now includes the destination batch.** `promote()` cleared the batch and left the
  student active — which is exactly the forbidden record, produced every single time somebody
  was promoted. It now takes a batch that teaches the *new* level and moves them straight into
  it. Where no batch teaches that level yet, the promotion is refused with that as the reason,
  and the dialog does not open.
- **"Take them off every batch" is gone from Move batch.** `assignToBatch(id, null)` is refused
  for an active student, and the dialog says to use Status instead — which clears the batch
  properly, as part of recording that they have stopped attending.
- **Returning from leave asks which batch.** `setStatus(ACTIVE)` on a student whose batch was
  cleared when they left now requires one, offering only batches teaching their level at their
  branch.
- **Editing cannot blank a mandatory field.** `updateStudent()` validates the *merged* record,
  not just the fields sent, so no partial write can empty one.

Not scoped to active students, deliberately: a graduated or inactive student *should* have no
batch, and leaving them on a register is the opposite mistake.

### Fixed

- **A student moved out of a closing batch now gets the new batch's timetable.**
  `closeBatch(…, { moveTo })` reassigned `batchId` but left `batchSchedule` — the copy each
  student carries for the Parent Portal — naming the batch being closed, with its old days and
  times. Nothing else rewrites that field until the student is next edited by hand, so every
  family moved out of a closing batch would have read the wrong timetable indefinitely.
- **Leaving now clears the stale timetable copy too.** `setStatus()` cleared `batchId` on a
  leaver but left `batchSchedule` behind it, so a graduated student's family kept seeing a
  class schedule.

### Changed — fee plan is protected like the mandatory field it is

- **Deleting a fee plan no longer unlinks the students on it.** `deleteFeePlan()` set
  `feePlanId: null` on every student pointing at the plan, which silently created exactly the
  record the rest of the ERP refuses to save — and stopped their billing outright, because
  `runBillingScheduler()` only raises fees for a student who has a plan. It now refuses while
  students remain and accepts a `moveTo` plan to reassign them in one go, following
  `closeBatch()`, which had the same problem with batches. The refusal carries the student
  list so a UI can name them. Counts students of every status: a graduated student with
  unsettled invoices and a dangling `feePlanId` is exactly as broken.
- **A student on a retired fee plan can still be edited.** Only active plans are offered, so
  the moment a plan was retired every student on it became un-editable — their own plan was
  not in the list, the select fell back to the placeholder, and the form demanded a new plan
  before it would save a corrected phone number. The student’s current plan is now kept in
  the list and marked “(retired)”; every other retired plan stays hidden.

### Fixed — deployment

- **The app shell is no longer CDN-cached for an hour after a deploy.** `firebase.json`’s
  no-cache header matched the literal path `/index.html`, which the SPA rewrite never produces
  for a request to `/` — so every `.js` and `.css` was `no-cache` while the page loading them
  was cached for an hour, and anyone with the app open kept the old shell until it expired. A
  `"source": "/"` rule alongside the existing one closes it. Carried since UAT Round 5 and
  included here because v3.5.0 changes enough screens that a stale shell would be visible.
  `/` is the only HTTP path that serves the shell — the router is hash-based, so there are no
  deep paths to cover.

### Notes

- `confirmModal()` gains `cancelLabel` and `tone: null`, matching natyam-mobile, so the
  enrolment summary can read as a confirmation rather than a warning. Every existing call is
  unchanged.
- Date of birth and gender are **not** in the mandatory set — asked during the round and
  answered No on 2026-08-08. Both admission forms require them, so a student arriving through
  Admissions has both regardless; requiring them here would additionally block an unrelated
  edit on every student already on the roll who has neither.
- Move batch, Promote and Status all requiring a batch was confirmed in the same exchange.

---

## [3.4.0] — unreleased

UAT Round 5, Phases 1 and 2. Every desktop item in `UAT Round 5 - Phase 1.docx` and
`UAT Round 5 - Phase 2.docx`, plus the desktop half of items reported against mobile — a
workflow change lands in both apps or in neither.

BUG-507 (second parent application stuck on "Sending Details") is **not** in this release —
withdrawn during the round for re-testing.

### Added

- **Analytics rebuilt as a BI dashboard** (ENH-505). Executive KPI cards, auto-generated
  business insights above the charts, income and expense category splits, students by batch,
  admissions by month, and filters for date range, branch, academic year, course and batch.
  A course or batch filter deliberately does **not** narrow the money panels — the ledger
  carries a branch and nothing finer — and the page says so rather than implying otherwise.
- **Reverse a fee waiver** (ENH-507), with the waived invoices listed at all. A waiver zeroes
  the balance and every invoice list filters on `balance > 0`, so a written-off fee had been
  invisible on every screen and there was nothing to offer a reversal on.
- **A "Transactions" tab in Finance** (ENH-504). Money in and money out together, newest first,
  with Edit and Delete on the two kinds that can honestly carry them.
- **An Owner can be assigned to a batch** (ENH-512). `STAFF_ROLES` gains Owner with
  `teaches: true`; the picker reads "Taken by" and marks Owners.

### Fixed

- **Three literal `role === 'teacher'` checks blocked the Owner change** (ENH-512). Editing a
  teacher to Owner was read as a demotion and demanded five batches be reassigned; handing a
  leaving teacher's classes to the Owner was refused with "is not an active teacher". A fourth
  in analytics left an Owner teaching every batch out of the teacher comparison.
- **`byUserEmail()` could resolve a dormant staff record.** Two records may share an email —
  this school has exactly that — and a plain `find()` returned whichever Firestore handed back
  first. An active record now wins.
- **The user edit form could deactivate the last Administrator**, locking the school out. Its
  Status field routed through `updateUser()`, which knew none of the rules the Deactivate
  button enforces. Both now share one `assertMayDeactivate()`.
- **`editEntry()` looked in `this.data.rows`**, which has never existed — Edit on a hand-typed
  ledger row did nothing at all and said nothing about it.
- **Payroll was missing from the expense breakdown** (ENH-504 Part 3). It read the `expenses`
  collection; payroll posts straight to the ledger. Both breakdowns are now ledger-derived.
- **Fee plan on the student form said nothing on edit** (BUG-504), so changing a plan looked as
  if it might re-bill and in fact did nothing visible. It now states that the change lands on
  the next billing cycle.

### Changed

- **Finance leads with a cashbook** (ENH-504). Tabs are Dashboard, Transactions, Payroll and
  **Advanced accounting** — the Ledger, unchanged, with every row, Edit, Delete and Reverse
  intact, moved last and renamed for what it is for. Header actions follow the tab.
- **Erase keeps staff and batches** (UAT5). Who teaches and which classes run are the school's
  shape, not its records, and rebuilding a timetable by hand after every erase is the chore
  that stops people erasing. The two are kept as a pair — a batch points at a staff record.
- **Analytics ranges** are 30 days / 3 / 6 / 12 months / custom, and trend lists are capped at
  four months, opening at the newest end.

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

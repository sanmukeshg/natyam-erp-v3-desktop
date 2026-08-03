# Migration checklist — natyam-admin

Source project: `D:\Shanki\Natyam\Projects\Natyam-ERP-UAT` (read-only reference throughout;
nothing in it was ever edited). Rows are added as files are actually touched, not
reconstructed after the fact. See `composed-popping-ritchie.md` (the approved plan) for the
rules this follows.

## Stage 0 — bootstrap skeleton, no feature modules

| Source path | Destination path | Action | Notes |
|---|---|---|---|
| `js/config/firebase.config.js` | same | copied as-is | same Firebase project (`natyam-erp`) as both new apps |
| `js/config/app.config.js` | same | trimmed | removed `NAVIGATION`/`ROUTES` exports (this app defines its own nav table separately, not yet added — see Stage 1); kept `APP`, `SESSION`, `SCHEMA`/`STORE_NAMES`, domain status enums, `CAPABILITIES`, `ROLES`, curriculum/role resolution helpers, `PREFERENCE_DEFAULTS` |
| `js/core/bus.js` | same | copied as-is | generic infra |
| `js/core/firebase.js` | same | copied as-is | generic infra |
| `js/core/session.js` | same | copied as-is | generic infra |
| `js/core/repository.js` | — | **excluded** | dead code for this app: no Firestore repository imports it (all import Firestore SDK + `core/firebase.js` directly); it only backs the archived IndexedDB repositories |
| `js/core/db.js` | — | **excluded** | IndexedDB is fully retired for every store this app uses; only `backup.service.js` (not yet migrated) and dev-only `seed.js`/archive files still reference it in the reference project — revisit when Settings/Data (backup & restore) is migrated, see open question below |
| `js/utils/date.js` | same | copied as-is | used by users/branches/sessions/auditLog repositories |
| `js/utils/id.js` | same | copied as-is | used by auditLog repository |
| `js/utils/dom.js` | same | copied as-is | used by login page (`html`/`render`/`on`/`raw`/`formData`) |
| `js/utils/csv.js`, `money.js` | — | **excluded (for now)** | no Stage 0 code needs them; added when a module that does is migrated |
| `js/data/sequenceGenerator.firestore.js` | same | copied as-is | used by users repository |
| `js/data/users.repository.firestore.js` | same | copied as-is | |
| `js/data/branches.repository.firestore.js` | same | copied as-is | |
| `js/data/sessions.repository.firestore.js` | same | copied as-is | login-session records, not Timetable class sessions (confusingly similar name — see `js/services/session.service.js` in the reference project, which is Timetable-only and is *not* copied here) |
| `js/data/auditLog.repository.firestore.js` | same | copied as-is | |
| `js/data/repositories.js` | same | **trimmed** | only re-exports `branches$`, `users$`, `authMethodsOf` — the reference file re-exports 28 entities |
| `js/services/auth.service.js` | same | copied as-is | |
| `js/services/auth/providers/{google,password,mobileOtp}Provider.js` | same | copied as-is | |
| `js/modules/auth/login.page.js` | same | copied as-is | not yet redesigned — login/landing has no `.dc.html` in the Design project yet |
| `assets/css/{tokens,base,auth}.css` | same | copied as-is | `components.css` and `shell.css`/mobile-shell CSS **excluded for now** — no module needs them yet |
| `assets/img/brand/*`, `assets/icons/*` | same | copied as-is | |
| `firestore.rules` | same | copied as-is | **canonical copy** — rules changes are authored here, mirrored to `natyam-mobile`'s reference copy |
| `docs/architecture/`, `docs/migrations/` | same | copied as-is | reference documentation |
| — | `js/app.js` | **new** | minimal boot: Firebase auth watch → `resolveProvisionedUser` → desktop role gate (administrator/owner_accountant/viewer; teacher_reception turned away) → session hydrate → placeholder authenticated screen. No router, no Shell, no idle-timer, no command palette yet — those arrive with the first real module in Stage 1 |
| — | `index.html`, `manifest.json` | **new** | "Natyam ERP v3 — Admin" branding from the start (branding was originally planned as a separate Stage 2 pass, but since these two files are new-not-copied, there was no unbranded version to transition from — trivial to just write correctly the first time) |

**Open question, not yet resolved — raise when Settings/Data is migrated:** the reference
project's `backup.service.js` still reads/writes IndexedDB directly for legacy-backup-file
compatibility (`db.exportAll()`/`db.importAll()`, a `settings` store fallback). Whether
`natyam-admin`'s eventual Backup & Restore screen needs the same IndexedDB-era compatibility,
or can drop it since no device running this new app ever had IndexedDB data in the first
place, is a real decision — not made here.

## Stage 1 — Dashboard (+ the shell and navigation it needs)

The Dashboard is an aggregate view, so its dependency closure is the widest of any
module — it reads from most collections even though most *screens* do not exist yet. That
is the Dashboard's nature, not speculative copying: the closure below was computed from
its actual imports, not assumed.

### Redesigned (implemented from the approved Claude Design project)

| Source | Destination | Action | Notes |
|---|---|---|---|
| `js/ui/shell.js` | same | **redesigned per `Sidebar Navigation.dc.html`** | Accordion nav (one group open at a time, auto-opens the active group), 64px icon rail, in-sidebar jump search. Same 5 groups / same routes / same capability gating as v2 — chrome changed, structure did not. The v2 shell's Ctrl-K palette button became the design's jump filter; `palette.js` is therefore **not** copied. The v2 footer (backup status) is dropped — the design has no footer, so `backup.service.js` is not needed either |
| `js/modules/dashboard/dashboard.page.js` | same | **redesigned per `Dashboard.dc.html`** (desktop half) | KPI strip → Needs attention + Today → Money + The roll → Recent activity. Still computes nothing; every figure comes from `dashboard.service.js`. **Teacher-mode variant deliberately not implemented** — this app turns Teacher & Reception away, so `forTeacher()` is left unused here for natyam-mobile |
| — | `assets/css/v3.css` | **new** | The v3 design layer: warm glass on the school's stage artwork, in the design's own dark and light variants, wired to the existing `[data-theme]` preference. Values transcribed from the design files. `tokens.css` is untouched and still supplies type scale, spacing, radii, motion, z-index |
| — | `js/config/navigation.js` | **new** | This app's own nav/route table (not shared with mobile). `load: null` marks a module as not-yet-migrated; migrating one is a one-line change here |
| — | `js/modules/system/pending.page.js` | **new** | Honest placeholder for the 14 routes whose modules have not moved yet, so the full five-group sidebar can render without broken imports |
| — | `tools/verify-imports.cjs` | **new** | Static import checker. With no build step nothing else validates the module graph; run `node tools/verify-imports.cjs` after every module |

### Copied unmodified (business logic preserved exactly)

| Source | Action | Notes |
|---|---|---|
| `js/core/router.js` | copied as-is | |
| `js/services/{dashboard,admissions,attendance,audit,fees,finance,notifications,session}.service.js` | copied as-is | `session.service.js` here is **Timetable class sessions**, not login sessions |
| `js/data/{students,batches,admissions,invoices,payments,programs,attendance,staff,holidays,drafts,feePlans,settings,ledger,expenses,salaries,notifications,certificates,classSessions}.repository.firestore.js` | copied as-is | 18 repositories, all named by the closure above |
| `js/ui/{icons,toast}.js`, `js/utils/money.js` | copied as-is | |
| `js/data/repositories.js` | **extended** | Now re-exports the ~30 names this closure imports (was 3 after Stage 0). Still far short of the reference file's full re-export |

### Excluded / removed in this stage

| File | Action | Why |
|---|---|---|
| `js/ui/chart.js` | copied, then **removed** | The v3 design draws its income bars and level meters in CSS, so nothing imported it. Will return with Analytics/Reports, which need real SVG charts |
| `js/ui/palette.js` | **excluded** | The design replaces the Ctrl-K palette with an in-sidebar jump filter |
| `js/services/backup.service.js` | **excluded** | Only the v2 shell footer used it; the v3 shell has no footer. Returns with Settings → Data |
| `js/modules/dashboard`'s teacher view | **not ported** | Belongs to natyam-mobile (see above) |
| `assets/css/components.css` | still **excluded** | No migrated screen needs v2's opaque-surface component styles yet. It comes in with the first module that does — likely Students (tables) — at which point its glass treatment gets specified by `Students.dc.html` |

### Verified

- `node tools/verify-imports.cjs` → 54 modules reached, all imports resolve, no missing named exports, nothing unreached.
- Browser: app boots, login screen renders, no console errors.
- Shell rendered under a harnessed Owner & Accountant session: 5 accordion groups, exclusive open, auto-open on the active route, jump search filters to matching pages and auto-opens their group, icon rail hides labels while keeping every item reachable, branch switcher populated, theme toggle switches between the design's dark and light variants.
- Dashboard view rendered against data shaped like `overview()`'s real output: 5 tone-coded KPIs, all five design sections, 6 income bars, 4 level meters, 3 register-state badges.
- **Not verified:** a real signed-in session against live Firestore — that needs real credentials. The unauthenticated path was exercised and correctly refuses to render any route.

## Stage 2 — natyam-mobile shell + Dashboard

No change to this repo. See `natyam-mobile/MIGRATION_CHECKLIST.md`. Re-verified here after
that stage: still boots, no console errors.

## Stage 3 — Students

### Redesigned / new

| Source | Destination | Action | Notes |
|---|---|---|---|
| `js/modules/students/students.page.js` | same | **redesigned per `Students.dc.html`** (desktop half) | Two deliberate departures from v2, both from the design: the roll is a **compact card list, not a `<table>`**, and the profile is a **centred modal, not the right-side drawer**. The design project's own change log records the modal swap as a direct request, so it is not an artefact of the mock |
| — | `assets/css/v3.css` (appended) | **new section** | Roll list, filter bar, pills, profile modal, metrics/notices/facts |

### Copied unmodified

`js/services/students.service.js`, plus `js/data/{curricula,documents}.repository.firestore.js`.
`repositories.js` extended with `curricula$` and `documents$` only.

### Excluded / removed

| File | Action | Why |
|---|---|---|
| `js/data/academicYears.repository.firestore.js` | copied, then **removed** | My closure tool over-reported: it followed the *reference* `repositories.js`, which re-exports every entity. This repo's trimmed version does not, so nothing reached it. Returns with Settings |
| `js/data/curriculumLevels.repository.firestore.js` | copied, then **removed** | Same reason |
| `assets/css/components.css` | still **excluded** | The design's roll is a card list, so there is still no table to style. This is the module that would have pulled `components.css` in, and it did not |

### Not wired (drawn, but deliberately inert)

The profile's operation buttons — Move batch, Collect fee, Promote, Status, Issue certificate —
and Edit/Add student are rendered per the design but **disabled with a tooltip**, because each
needs its own form or confirm flow and several depend on modules that have not migrated (Fees,
Certificates). Shown-but-disabled beats live buttons that silently do nothing.

### Verified

- `node tools/verify-imports.cjs` → 58 modules, all resolve, nothing unreached.
- Roll: 3 rows, correct fee chips (`Paid up` / `₹3,500 overdue` / `₹1,500 due`) and status
  chips, filter bar with all four pills, live count subtitle.
- Profile modal: title/subtitle, all five ops present **and all disabled**, six tabs with
  Overview selected, three metrics, both notices (no-batch + medical), facts list.
- Nav: Students now `data-pending="false"`; pending count 14 → 13.
- **Bug found and fixed (affects both apps):** the design's "light" variant keeps *white* type
  (`nameColor: #FFFFFF`) — it is lighter glass on a dark photo, not a light theme. I had
  mirrored its `scrim: rgba(255,248,239,0.22)`, which *lightens* the backdrop and left white
  text washed out over the bright part of the artwork. The scrim now darkens in both variants;
  only the glass above it lightens.

## Stage 4 — Guardian Portal (natyam-mobile only)

No change to this repo. See `natyam-mobile/MIGRATION_CHECKLIST.md`.

## Stage 5 — Attendance (the register)

### ⚠️ Built without an approved design

The Claude Design project was deleted before `Attendance.dc.html` could be retrieved (see
`docs/design/README.md`), and Claude Design could not regenerate it. On the user's explicit
instruction, this screen was built directly rather than waiting. That was a smaller risk than
it sounds, because neither half was invented:

- **The interaction is ported.** v2's `attendance.page.js` states its own rule — *"built for
  one-handed speed: everybody starts present, marking is one tap"* — and that is preserved
  exactly, along with All present / All absent. A teacher who used v2 relearns nothing.
- **The visual language is the implemented v3 system** in `assets/css/v3.css`, already proven
  on Dashboard and Students.

**If `Attendance.dc.html` is ever recovered, this is the file to reconcile against it.** The
business logic underneath is untouched, so that would be a markup-and-CSS change.

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/attendance/attendance.page.js` | **new** | Two views: the day board (every batch meeting on a date, done/rate, missing-registers card with count badge) and the register itself |
| `assets/css/v3.css` (appended) | **new section** | Roster rows, the present/absent states, the save bar |

### Copied unmodified

`js/services/attendance.service.js` and `js/services/session.service.js` were already present
from Stage 1 (the Dashboard's closure). **No new files were needed** — Attendance's entire
dependency closure was already satisfied.

### Design decisions worth naming

- **Present is quiet; absent shouts.** A teacher scanning a roster should see the *absences*,
  not forty equally-loud rows. Present is a hairline green edge; absent is a filled red row.
- **One tap re-renders one row**, not the roster. Repainting everything would lose scroll
  position — unacceptable when working down a list of forty.
- **The marking-window rule is the service's**, asked via `markingWindow()` before the UI
  offers to save, never re-implemented here. No future dates; nothing older than 30 days.
- **Postpone / Cancel class / Class calendar are drawn but disabled.** Each needs a reason and
  (for postpone) a replacement date — real forms that belong with Timetable.
- **Attendance was temporarily un-hidden in the sidebar.** The reference app hides it and
  reaches it from Timetable's "Take register" (Milestone B2). Timetable has not migrated, so
  hiding it would leave the register reachable only by typing a URL. **Restore `hidden: true`
  in `js/config/navigation.js` when Timetable lands.**

### Verified

- `node tools/verify-imports.cjs` → 59 modules, all resolve, nothing unreached.
- Day board: 3 classes with correct badges (`92% present` / `Not marked`), missing-registers
  card with count `2` and per-row Mark buttons, date navigation and Today.
- Register: roster renders, everyone starts present, **one tap flips exactly one student**
  (verified DOM *and* in-memory model agree after two independent taps), tally updates, bulk
  actions work, class-ops correctly disabled, rows ≥62px.
- **A false alarm worth recording:** an intermediate screenshot appeared to show the *wrong*
  student marked absent. Investigated rather than dismissed — it was cross-contamination from
  a failed earlier harness leaving a second page instance bound to the same container, not a
  product defect. Re-tested on a clean page: correct.
- **Not verified:** `postRegister()` against live Firestore. This is v3's **first write path**,
  and it has only been exercised up to the service call — the save itself needs a real
  signed-in teacher.

## Stage 6 — Admissions

### ⚠️ Built without an approved design

`Admissions.dc.html` was lost with the design project (see `docs/design/README.md`). Built
directly on the user's instruction. As with Attendance, neither half was invented:

- **The workflow is the service's, not this page's.** `nextActionFor()` in
  `admissions.service.js` already defines exactly one next step per status — draft→submit,
  submitted→review, reviewing→approve, approved→enrol, rejected→reopen, enrolled→nothing. The
  page renders that ladder; it does not decide it.
- **The visual language is the implemented v3 system**, proven across three prior screens.

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/admissions/admissions.page.js` | **new** | Pipeline stats, status filter pills, application list, detail modal carrying the ladder |
| `assets/css/v3.css` (appended) | **new section** | Status chips + pipeline card sizing |

### Copied unmodified

**Nothing new.** `admissions.service.js` arrived with Stage 1's Dashboard closure, and its
whole dependency closure was already satisfied.

### What works, and what does not

**Working end to end:** Begin review → Approve → Enrol (with a batch picker fed by the
service's own `eligibleBatches`), plus Reject with a required reason and Reopen. Capability
gating mirrors the service's `session.require()` calls exactly, so the UI never offers what
the service will refuse.

**Not built:** taking a *new* application. Intake is a multi-step wizard (`ADMISSION_STEPS` +
`validateStep` + `saveDraft`) that deserves its own stage; `js/ui/wizard.js` is deliberately
still not copied in. The button is present and disabled with an explanation. What this screen
does is the daily job — processing what has already arrived.

### Verified

- `node tools/verify-imports.cjs` → 60 modules, all resolve, nothing unreached.
- List: six pipeline stat cards with correct tones, six filter pills, four applications with
  correctly coloured status chips, and the "waiting 13d" stall flag on the one stalled row.
- **The ladder, tested across every status** — submitted → *Begin review* (+ Reject);
  reviewing → *Approve* (+ Reject); approved → *Enrol* with the batch picker appearing and
  Reject correctly **absent**; enrolled → no action, closed note; rejected → *Reopen*. Matches
  `nextActionFor()` exactly.
- **A permission finding, confirmed not a bug:** Teacher & Reception shows `admission.approve`
  as granted. Checked against `ROLES` — it genuinely holds that capability, because it is a
  combined teaching *and reception* role and reception processes admissions. The UI is correct
  to enable it.
- **Not verified:** any of the write paths (`beginReview`, `approve`, `reject`,
  `enrolApplicant`, `reopen`) against live Firestore.

## Stage 7 — Timetable (and restoring Attendance's entry point)

### ⚠️ Built without the design file — but one instruction survived

`Timetable.dc.html` was lost, but the design project's own change log (preserved in
`docs/design/README.md`) recorded two decisions about it, and both are honoured:

> "weekly grid (Desktop) and day-picker + agenda (Mobile)"
> "tiles … now show only the batch name and time slot — dropped the stacked curriculum
> levels / teacher / room line, matching v2.25.0's tile simplification"

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/batches/timetable.page.js` | **new** | Seven-column week, five slot states, legend, week navigation |
| `assets/css/v3.css` (appended) | **new section** | Week grid, slot tiles and states, legend |

### Copied unmodified

`js/services/batches.service.js` — **caught by the import checker**, not by inspection: the
first verify run after writing the page failed with `MISSING FILE … batches.service.js`. Its
own closure was already satisfied.

### Attendance's entry point restored

`/attendance` is **`hidden: true` again**, matching the reference app (Milestone B2). Timetable
tiles now link to `#/attendance?date=…&batch=…`, and both Attendance pages consume that
`batch` param **once**, on first load — so "All classes" afterwards genuinely returns to the
day board instead of bouncing back into the register.

### One departure from the design instruction, and why

Tile names **wrap to two lines** rather than truncating. Seven columns leaves ~125px per tile,
and "Foundation Level 1" does not fit on one line at that width — the ellipsis turned every
tile into "Foundation Lev…", which tells a reader nothing. The instruction was *name + time*;
it did not ask for an unreadable name. Two lines is the cap, past which a tile starts becoming
the paragraph v2.25.0 removed. Caught in visual review, not by a test.

### Verified

- `node tools/verify-imports.cjs` → 62 modules, all resolve, nothing unreached.
- Seven day columns; every tile exactly two lines (name + time); all five states correct —
  marked, needs-marking, upcoming, cancelled (disabled), replacement; five legend items; week
  navigation and "This week"; today's column carries the accent edge.
- After the wrap fix: no tile name clipped.

## Stage 8 — Fee collection

### ⚠️ No design existed for this screen at all

Unlike Attendance and Timetable, Fees was **never part of the Claude Design project** — there
is not even a lost file to reconcile against later. Built from the v3 system already proven
across five screens.

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/fees/fees.page.js` | **new** | Month summary, ageing breakdown, filters, student worklist, per-student ledger, inline collect form |
| `assets/css/v3.css` (appended) | **new section** | Ageing cells, invoice rows, the payment form |

### Copied unmodified

**Nothing new** — `fees.service.js` arrived with Stage 1's Dashboard closure.

### Model: student-centric, not invoice-centric

Carried over from the reference app deliberately. A school collects money from a **person
standing at a desk**, not from an invoice number — so the list is students who owe (sorted by
who owes most and longest, because it is a worklist), and opening one shows their invoices,
their receipts, and the form to take money against a specific invoice.

The collect form expands **under the invoice it belongs to** rather than in a second dialog:
the amount and the balance it settles must be readable at the same time, or somebody will
collect against the wrong invoice.

The form mirrors the service's validation where it is cheap (max = balance, mode list,
conditional reference field, no future date) but **never replaces it** — `recordPayment()`
re-validates everything and remains the authority.

### Verified against live Firestore

- Month summary, ageing (₹2.59L at 1–30 days, ₹25K at 31–60, ₹0 not-yet-due), 157 real rows.
- `?filter=overdue` deep link from the Dashboard's "Chase payments" lands correctly.
- Opened a real student: billed/collected/outstanding correct, overdue notice with the true
  oldest due date, real invoice number and due date.
- Collect form: amount defaults to the balance and is capped at it, reference is required for
  UPI and **hidden for Cash**, "balance after this" tracks a part payment (₹2,000 − ₹500 =
  ₹1,500), received-on capped at today.
- **`recordPayment()` was deliberately NOT submitted** — this is real money against real
  records, and that is the user's call to make.

---

## 🐛 Two bugs found by testing on live data (both fixed)

### 1. Modals dismissed when you clicked inside them

The backdrop carried the close action **and wrapped the dialog**, so the delegated
`closest('[data-action="close-…"]')` match resolved *any* click inside the modal to the
backdrop. Clicking a tab, a form field or the Collect button silently closed the dialog. The
`stopPropagation()` guard was useless: both handlers are delegated on the same root node, so
the event has already reached it.

Fixed by giving the backdrop `data-role="scrim"` and comparing `event.target` to the matched
element — distinguishing "clicked the backdrop" from "clicked something the backdrop
contains". Affected **all three desktop modals** (Students, Admissions, Fees). Mobile was
never affected: there the scrim is rendered as a *sibling* of the sheet, not a parent.

### 2. Every page leaked its event listeners onto the next page

`on()` binds to the page container, which the router **renders into rather than replaces**, so
a listener that is never disposed outlives its page. The reference project wraps every such
call in `this.onDispose(...)`; none of the v3 pages did.

Symptom, caught from a stray URL in a diagnostic: clicking a row on **Fee collection** fired
the previous **Timetable** page's handler and navigated to
`#/attendance?date=undefined&batch=undefined`. Both pages use `data-action="open"`, so the
stale handler matched.

**64 unwrapped listeners across 9 page files, in both apps** — every page written so far.
All now wrapped, matching the reference pattern. Verified end to end: visiting Timetable then
Fees and clicking a row now stays on Fees.

## Stage 10 — Notifications + My account

### ⚠️ Neither screen was ever in the Claude Design project

Not lost like Attendance — never drawn at all. Built from the v3 system.

### New

| Destination | Action |
|---|---|
| `js/modules/notifications/notifications.page.js` | **new** |
| `js/modules/auth/profile.page.js` | **new** |
| `assets/css/v3.css` (appended) | **new sections** — alert rows, severity icons, identity card |

### Copied unmodified

**Nothing new.** `notifications.service.js` arrived with the Dashboard closure; the account
screen needs only `users# Migration checklist — natyam-admin

Source project: `D:\Shanki\Natyam\Projects\Natyam-ERP-UAT` (read-only reference throughout;
nothing in it was ever edited). Rows are added as files are actually touched, not
reconstructed after the fact. See `composed-popping-ritchie.md` (the approved plan) for the
rules this follows.

## Stage 0 — bootstrap skeleton, no feature modules

| Source path | Destination path | Action | Notes |
|---|---|---|---|
| `js/config/firebase.config.js` | same | copied as-is | same Firebase project (`natyam-erp`) as both new apps |
| `js/config/app.config.js` | same | trimmed | removed `NAVIGATION`/`ROUTES` exports (this app defines its own nav table separately, not yet added — see Stage 1); kept `APP`, `SESSION`, `SCHEMA`/`STORE_NAMES`, domain status enums, `CAPABILITIES`, `ROLES`, curriculum/role resolution helpers, `PREFERENCE_DEFAULTS` |
| `js/core/bus.js` | same | copied as-is | generic infra |
| `js/core/firebase.js` | same | copied as-is | generic infra |
| `js/core/session.js` | same | copied as-is | generic infra |
| `js/core/repository.js` | — | **excluded** | dead code for this app: no Firestore repository imports it (all import Firestore SDK + `core/firebase.js` directly); it only backs the archived IndexedDB repositories |
| `js/core/db.js` | — | **excluded** | IndexedDB is fully retired for every store this app uses; only `backup.service.js` (not yet migrated) and dev-only `seed.js`/archive files still reference it in the reference project — revisit when Settings/Data (backup & restore) is migrated, see open question below |
| `js/utils/date.js` | same | copied as-is | used by users/branches/sessions/auditLog repositories |
| `js/utils/id.js` | same | copied as-is | used by auditLog repository |
| `js/utils/dom.js` | same | copied as-is | used by login page (`html`/`render`/`on`/`raw`/`formData`) |
| `js/utils/csv.js`, `money.js` | — | **excluded (for now)** | no Stage 0 code needs them; added when a module that does is migrated |
| `js/data/sequenceGenerator.firestore.js` | same | copied as-is | used by users repository |
| `js/data/users.repository.firestore.js` | same | copied as-is | |
| `js/data/branches.repository.firestore.js` | same | copied as-is | |
| `js/data/sessions.repository.firestore.js` | same | copied as-is | login-session records, not Timetable class sessions (confusingly similar name — see `js/services/session.service.js` in the reference project, which is Timetable-only and is *not* copied here) |
| `js/data/auditLog.repository.firestore.js` | same | copied as-is | |
| `js/data/repositories.js` | same | **trimmed** | only re-exports `branches$`, `users$`, `authMethodsOf` — the reference file re-exports 28 entities |
| `js/services/auth.service.js` | same | copied as-is | |
| `js/services/auth/providers/{google,password,mobileOtp}Provider.js` | same | copied as-is | |
| `js/modules/auth/login.page.js` | same | copied as-is | not yet redesigned — login/landing has no `.dc.html` in the Design project yet |
| `assets/css/{tokens,base,auth}.css` | same | copied as-is | `components.css` and `shell.css`/mobile-shell CSS **excluded for now** — no module needs them yet |
| `assets/img/brand/*`, `assets/icons/*` | same | copied as-is | |
| `firestore.rules` | same | copied as-is | **canonical copy** — rules changes are authored here, mirrored to `natyam-mobile`'s reference copy |
| `docs/architecture/`, `docs/migrations/` | same | copied as-is | reference documentation |
| — | `js/app.js` | **new** | minimal boot: Firebase auth watch → `resolveProvisionedUser` → desktop role gate (administrator/owner_accountant/viewer; teacher_reception turned away) → session hydrate → placeholder authenticated screen. No router, no Shell, no idle-timer, no command palette yet — those arrive with the first real module in Stage 1 |
| — | `index.html`, `manifest.json` | **new** | "Natyam ERP v3 — Admin" branding from the start (branding was originally planned as a separate Stage 2 pass, but since these two files are new-not-copied, there was no unbranded version to transition from — trivial to just write correctly the first time) |

**Open question, not yet resolved — raise when Settings/Data is migrated:** the reference
project's `backup.service.js` still reads/writes IndexedDB directly for legacy-backup-file
compatibility (`db.exportAll()`/`db.importAll()`, a `settings` store fallback). Whether
`natyam-admin`'s eventual Backup & Restore screen needs the same IndexedDB-era compatibility,
or can drop it since no device running this new app ever had IndexedDB data in the first
place, is a real decision — not made here.

## Stage 1 — Dashboard (+ the shell and navigation it needs)

The Dashboard is an aggregate view, so its dependency closure is the widest of any
module — it reads from most collections even though most *screens* do not exist yet. That
is the Dashboard's nature, not speculative copying: the closure below was computed from
its actual imports, not assumed.

### Redesigned (implemented from the approved Claude Design project)

| Source | Destination | Action | Notes |
|---|---|---|---|
| `js/ui/shell.js` | same | **redesigned per `Sidebar Navigation.dc.html`** | Accordion nav (one group open at a time, auto-opens the active group), 64px icon rail, in-sidebar jump search. Same 5 groups / same routes / same capability gating as v2 — chrome changed, structure did not. The v2 shell's Ctrl-K palette button became the design's jump filter; `palette.js` is therefore **not** copied. The v2 footer (backup status) is dropped — the design has no footer, so `backup.service.js` is not needed either |
| `js/modules/dashboard/dashboard.page.js` | same | **redesigned per `Dashboard.dc.html`** (desktop half) | KPI strip → Needs attention + Today → Money + The roll → Recent activity. Still computes nothing; every figure comes from `dashboard.service.js`. **Teacher-mode variant deliberately not implemented** — this app turns Teacher & Reception away, so `forTeacher()` is left unused here for natyam-mobile |
| — | `assets/css/v3.css` | **new** | The v3 design layer: warm glass on the school's stage artwork, in the design's own dark and light variants, wired to the existing `[data-theme]` preference. Values transcribed from the design files. `tokens.css` is untouched and still supplies type scale, spacing, radii, motion, z-index |
| — | `js/config/navigation.js` | **new** | This app's own nav/route table (not shared with mobile). `load: null` marks a module as not-yet-migrated; migrating one is a one-line change here |
| — | `js/modules/system/pending.page.js` | **new** | Honest placeholder for the 14 routes whose modules have not moved yet, so the full five-group sidebar can render without broken imports |
| — | `tools/verify-imports.cjs` | **new** | Static import checker. With no build step nothing else validates the module graph; run `node tools/verify-imports.cjs` after every module |

### Copied unmodified (business logic preserved exactly)

| Source | Action | Notes |
|---|---|---|
| `js/core/router.js` | copied as-is | |
| `js/services/{dashboard,admissions,attendance,audit,fees,finance,notifications,session}.service.js` | copied as-is | `session.service.js` here is **Timetable class sessions**, not login sessions |
| `js/data/{students,batches,admissions,invoices,payments,programs,attendance,staff,holidays,drafts,feePlans,settings,ledger,expenses,salaries,notifications,certificates,classSessions}.repository.firestore.js` | copied as-is | 18 repositories, all named by the closure above |
| `js/ui/{icons,toast}.js`, `js/utils/money.js` | copied as-is | |
| `js/data/repositories.js` | **extended** | Now re-exports the ~30 names this closure imports (was 3 after Stage 0). Still far short of the reference file's full re-export |

### Excluded / removed in this stage

| File | Action | Why |
|---|---|---|
| `js/ui/chart.js` | copied, then **removed** | The v3 design draws its income bars and level meters in CSS, so nothing imported it. Will return with Analytics/Reports, which need real SVG charts |
| `js/ui/palette.js` | **excluded** | The design replaces the Ctrl-K palette with an in-sidebar jump filter |
| `js/services/backup.service.js` | **excluded** | Only the v2 shell footer used it; the v3 shell has no footer. Returns with Settings → Data |
| `js/modules/dashboard`'s teacher view | **not ported** | Belongs to natyam-mobile (see above) |
| `assets/css/components.css` | still **excluded** | No migrated screen needs v2's opaque-surface component styles yet. It comes in with the first module that does — likely Students (tables) — at which point its glass treatment gets specified by `Students.dc.html` |

### Verified

- `node tools/verify-imports.cjs` → 54 modules reached, all imports resolve, no missing named exports, nothing unreached.
- Browser: app boots, login screen renders, no console errors.
- Shell rendered under a harnessed Owner & Accountant session: 5 accordion groups, exclusive open, auto-open on the active route, jump search filters to matching pages and auto-opens their group, icon rail hides labels while keeping every item reachable, branch switcher populated, theme toggle switches between the design's dark and light variants.
- Dashboard view rendered against data shaped like `overview()`'s real output: 5 tone-coded KPIs, all five design sections, 6 income bars, 4 level meters, 3 register-state badges.
- **Not verified:** a real signed-in session against live Firestore — that needs real credentials. The unauthenticated path was exercised and correctly refuses to render any route.

## Stage 2 — natyam-mobile shell + Dashboard

No change to this repo. See `natyam-mobile/MIGRATION_CHECKLIST.md`. Re-verified here after
that stage: still boots, no console errors.

## Stage 3 — Students

### Redesigned / new

| Source | Destination | Action | Notes |
|---|---|---|---|
| `js/modules/students/students.page.js` | same | **redesigned per `Students.dc.html`** (desktop half) | Two deliberate departures from v2, both from the design: the roll is a **compact card list, not a `<table>`**, and the profile is a **centred modal, not the right-side drawer**. The design project's own change log records the modal swap as a direct request, so it is not an artefact of the mock |
| — | `assets/css/v3.css` (appended) | **new section** | Roll list, filter bar, pills, profile modal, metrics/notices/facts |

### Copied unmodified

`js/services/students.service.js`, plus `js/data/{curricula,documents}.repository.firestore.js`.
`repositories.js` extended with `curricula$` and `documents$` only.

### Excluded / removed

| File | Action | Why |
|---|---|---|
| `js/data/academicYears.repository.firestore.js` | copied, then **removed** | My closure tool over-reported: it followed the *reference* `repositories.js`, which re-exports every entity. This repo's trimmed version does not, so nothing reached it. Returns with Settings |
| `js/data/curriculumLevels.repository.firestore.js` | copied, then **removed** | Same reason |
| `assets/css/components.css` | still **excluded** | The design's roll is a card list, so there is still no table to style. This is the module that would have pulled `components.css` in, and it did not |

### Not wired (drawn, but deliberately inert)

The profile's operation buttons — Move batch, Collect fee, Promote, Status, Issue certificate —
and Edit/Add student are rendered per the design but **disabled with a tooltip**, because each
needs its own form or confirm flow and several depend on modules that have not migrated (Fees,
Certificates). Shown-but-disabled beats live buttons that silently do nothing.

### Verified

- `node tools/verify-imports.cjs` → 58 modules, all resolve, nothing unreached.
- Roll: 3 rows, correct fee chips (`Paid up` / `₹3,500 overdue` / `₹1,500 due`) and status
  chips, filter bar with all four pills, live count subtitle.
- Profile modal: title/subtitle, all five ops present **and all disabled**, six tabs with
  Overview selected, three metrics, both notices (no-batch + medical), facts list.
- Nav: Students now `data-pending="false"`; pending count 14 → 13.
- **Bug found and fixed (affects both apps):** the design's "light" variant keeps *white* type
  (`nameColor: #FFFFFF`) — it is lighter glass on a dark photo, not a light theme. I had
  mirrored its `scrim: rgba(255,248,239,0.22)`, which *lightens* the backdrop and left white
  text washed out over the bright part of the artwork. The scrim now darkens in both variants;
  only the glass above it lightens.

## Stage 4 — Guardian Portal (natyam-mobile only)

No change to this repo. See `natyam-mobile/MIGRATION_CHECKLIST.md`.

## Stage 5 — Attendance (the register)

### ⚠️ Built without an approved design

The Claude Design project was deleted before `Attendance.dc.html` could be retrieved (see
`docs/design/README.md`), and Claude Design could not regenerate it. On the user's explicit
instruction, this screen was built directly rather than waiting. That was a smaller risk than
it sounds, because neither half was invented:

- **The interaction is ported.** v2's `attendance.page.js` states its own rule — *"built for
  one-handed speed: everybody starts present, marking is one tap"* — and that is preserved
  exactly, along with All present / All absent. A teacher who used v2 relearns nothing.
- **The visual language is the implemented v3 system** in `assets/css/v3.css`, already proven
  on Dashboard and Students.

**If `Attendance.dc.html` is ever recovered, this is the file to reconcile against it.** The
business logic underneath is untouched, so that would be a markup-and-CSS change.

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/attendance/attendance.page.js` | **new** | Two views: the day board (every batch meeting on a date, done/rate, missing-registers card with count badge) and the register itself |
| `assets/css/v3.css` (appended) | **new section** | Roster rows, the present/absent states, the save bar |

### Copied unmodified

`js/services/attendance.service.js` and `js/services/session.service.js` were already present
from Stage 1 (the Dashboard's closure). **No new files were needed** — Attendance's entire
dependency closure was already satisfied.

### Design decisions worth naming

- **Present is quiet; absent shouts.** A teacher scanning a roster should see the *absences*,
  not forty equally-loud rows. Present is a hairline green edge; absent is a filled red row.
- **One tap re-renders one row**, not the roster. Repainting everything would lose scroll
  position — unacceptable when working down a list of forty.
- **The marking-window rule is the service's**, asked via `markingWindow()` before the UI
  offers to save, never re-implemented here. No future dates; nothing older than 30 days.
- **Postpone / Cancel class / Class calendar are drawn but disabled.** Each needs a reason and
  (for postpone) a replacement date — real forms that belong with Timetable.
- **Attendance was temporarily un-hidden in the sidebar.** The reference app hides it and
  reaches it from Timetable's "Take register" (Milestone B2). Timetable has not migrated, so
  hiding it would leave the register reachable only by typing a URL. **Restore `hidden: true`
  in `js/config/navigation.js` when Timetable lands.**

### Verified

- `node tools/verify-imports.cjs` → 59 modules, all resolve, nothing unreached.
- Day board: 3 classes with correct badges (`92% present` / `Not marked`), missing-registers
  card with count `2` and per-row Mark buttons, date navigation and Today.
- Register: roster renders, everyone starts present, **one tap flips exactly one student**
  (verified DOM *and* in-memory model agree after two independent taps), tally updates, bulk
  actions work, class-ops correctly disabled, rows ≥62px.
- **A false alarm worth recording:** an intermediate screenshot appeared to show the *wrong*
  student marked absent. Investigated rather than dismissed — it was cross-contamination from
  a failed earlier harness leaving a second page instance bound to the same container, not a
  product defect. Re-tested on a clean page: correct.
- **Not verified:** `postRegister()` against live Firestore. This is v3's **first write path**,
  and it has only been exercised up to the service call — the save itself needs a real
  signed-in teacher.

## Stage 6 — Admissions

### ⚠️ Built without an approved design

`Admissions.dc.html` was lost with the design project (see `docs/design/README.md`). Built
directly on the user's instruction. As with Attendance, neither half was invented:

- **The workflow is the service's, not this page's.** `nextActionFor()` in
  `admissions.service.js` already defines exactly one next step per status — draft→submit,
  submitted→review, reviewing→approve, approved→enrol, rejected→reopen, enrolled→nothing. The
  page renders that ladder; it does not decide it.
- **The visual language is the implemented v3 system**, proven across three prior screens.

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/admissions/admissions.page.js` | **new** | Pipeline stats, status filter pills, application list, detail modal carrying the ladder |
| `assets/css/v3.css` (appended) | **new section** | Status chips + pipeline card sizing |

### Copied unmodified

**Nothing new.** `admissions.service.js` arrived with Stage 1's Dashboard closure, and its
whole dependency closure was already satisfied.

### What works, and what does not

**Working end to end:** Begin review → Approve → Enrol (with a batch picker fed by the
service's own `eligibleBatches`), plus Reject with a required reason and Reopen. Capability
gating mirrors the service's `session.require()` calls exactly, so the UI never offers what
the service will refuse.

**Not built:** taking a *new* application. Intake is a multi-step wizard (`ADMISSION_STEPS` +
`validateStep` + `saveDraft`) that deserves its own stage; `js/ui/wizard.js` is deliberately
still not copied in. The button is present and disabled with an explanation. What this screen
does is the daily job — processing what has already arrived.

### Verified

- `node tools/verify-imports.cjs` → 60 modules, all resolve, nothing unreached.
- List: six pipeline stat cards with correct tones, six filter pills, four applications with
  correctly coloured status chips, and the "waiting 13d" stall flag on the one stalled row.
- **The ladder, tested across every status** — submitted → *Begin review* (+ Reject);
  reviewing → *Approve* (+ Reject); approved → *Enrol* with the batch picker appearing and
  Reject correctly **absent**; enrolled → no action, closed note; rejected → *Reopen*. Matches
  `nextActionFor()` exactly.
- **A permission finding, confirmed not a bug:** Teacher & Reception shows `admission.approve`
  as granted. Checked against `ROLES` — it genuinely holds that capability, because it is a
  combined teaching *and reception* role and reception processes admissions. The UI is correct
  to enable it.
- **Not verified:** any of the write paths (`beginReview`, `approve`, `reject`,
  `enrolApplicant`, `reopen`) against live Firestore.

## Stage 7 — Timetable (and restoring Attendance's entry point)

### ⚠️ Built without the design file — but one instruction survived

`Timetable.dc.html` was lost, but the design project's own change log (preserved in
`docs/design/README.md`) recorded two decisions about it, and both are honoured:

> "weekly grid (Desktop) and day-picker + agenda (Mobile)"
> "tiles … now show only the batch name and time slot — dropped the stacked curriculum
> levels / teacher / room line, matching v2.25.0's tile simplification"

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/batches/timetable.page.js` | **new** | Seven-column week, five slot states, legend, week navigation |
| `assets/css/v3.css` (appended) | **new section** | Week grid, slot tiles and states, legend |

### Copied unmodified

`js/services/batches.service.js` — **caught by the import checker**, not by inspection: the
first verify run after writing the page failed with `MISSING FILE … batches.service.js`. Its
own closure was already satisfied.

### Attendance's entry point restored

`/attendance` is **`hidden: true` again**, matching the reference app (Milestone B2). Timetable
tiles now link to `#/attendance?date=…&batch=…`, and both Attendance pages consume that
`batch` param **once**, on first load — so "All classes" afterwards genuinely returns to the
day board instead of bouncing back into the register.

### One departure from the design instruction, and why

Tile names **wrap to two lines** rather than truncating. Seven columns leaves ~125px per tile,
and "Foundation Level 1" does not fit on one line at that width — the ellipsis turned every
tile into "Foundation Lev…", which tells a reader nothing. The instruction was *name + time*;
it did not ask for an unreadable name. Two lines is the cap, past which a tile starts becoming
the paragraph v2.25.0 removed. Caught in visual review, not by a test.

### Verified

- `node tools/verify-imports.cjs` → 62 modules, all resolve, nothing unreached.
- Seven day columns; every tile exactly two lines (name + time); all five states correct —
  marked, needs-marking, upcoming, cancelled (disabled), replacement; five legend items; week
  navigation and "This week"; today's column carries the accent edge.
- After the wrap fix: no tile name clipped.

## Stage 8 — Fee collection

### ⚠️ No design existed for this screen at all

Unlike Attendance and Timetable, Fees was **never part of the Claude Design project** — there
is not even a lost file to reconcile against later. Built from the v3 system already proven
across five screens.

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/fees/fees.page.js` | **new** | Month summary, ageing breakdown, filters, student worklist, per-student ledger, inline collect form |
| `assets/css/v3.css` (appended) | **new section** | Ageing cells, invoice rows, the payment form |

### Copied unmodified

**Nothing new** — `fees.service.js` arrived with Stage 1's Dashboard closure.

### Model: student-centric, not invoice-centric

Carried over from the reference app deliberately. A school collects money from a **person
standing at a desk**, not from an invoice number — so the list is students who owe (sorted by
who owes most and longest, because it is a worklist), and opening one shows their invoices,
their receipts, and the form to take money against a specific invoice.

The collect form expands **under the invoice it belongs to** rather than in a second dialog:
the amount and the balance it settles must be readable at the same time, or somebody will
collect against the wrong invoice.

The form mirrors the service's validation where it is cheap (max = balance, mode list,
conditional reference field, no future date) but **never replaces it** — `recordPayment()`
re-validates everything and remains the authority.

### Verified against live Firestore

- Month summary, ageing (₹2.59L at 1–30 days, ₹25K at 31–60, ₹0 not-yet-due), 157 real rows.
- `?filter=overdue` deep link from the Dashboard's "Chase payments" lands correctly.
- Opened a real student: billed/collected/outstanding correct, overdue notice with the true
  oldest due date, real invoice number and due date.
- Collect form: amount defaults to the balance and is capped at it, reference is required for
  UPI and **hidden for Cash**, "balance after this" tracks a part payment (₹2,000 − ₹500 =
  ₹1,500), received-on capped at today.
- **`recordPayment()` was deliberately NOT submitted** — this is real money against real
  records, and that is the user's call to make.

---

## 🐛 Two bugs found by testing on live data (both fixed)

### 1. Modals dismissed when you clicked inside them

The backdrop carried the close action **and wrapped the dialog**, so the delegated
`closest('[data-action="close-…"]')` match resolved *any* click inside the modal to the
backdrop. Clicking a tab, a form field or the Collect button silently closed the dialog. The
`stopPropagation()` guard was useless: both handlers are delegated on the same root node, so
the event has already reached it.

Fixed by giving the backdrop `data-role="scrim"` and comparing `event.target` to the matched
element — distinguishing "clicked the backdrop" from "clicked something the backdrop
contains". Affected **all three desktop modals** (Students, Admissions, Fees). Mobile was
never affected: there the scrim is rendered as a *sibling* of the sheet, not a parent.

### 2. Every page leaked its event listeners onto the next page

`on()` binds to the page container, which the router **renders into rather than replaces**, so
a listener that is never disposed outlives its page. The reference project wraps every such
call in `this.onDispose(...)`; none of the v3 pages did.

Symptom, caught from a stray URL in a diagnostic: clicking a row on **Fee collection** fired
the previous **Timetable** page's handler and navigated to
`#/attendance?date=undefined&batch=undefined`. Both pages use `data-action="open"`, so the
stale handler matched.

**64 unwrapped listeners across 9 page files, in both apps** — every page written so far.
All now wrapped, matching the reference pattern. Verified end to end: visiting Timetable then
Fees and clicking a row now stays on Fees.

, `authMethodsOf` and `setOwnPassword`, all already present.

### Severity is the service's, not the page's

`centre()` maps each row to error / warning / success / info on its own stated grounds —
*"what must I deal with" is the question being asked and the kind is only a hint towards the
answer*. These pages sort unread-then-severity-then-newest and render that mapping; they do
not re-derive it.

### ⚠️ One deliberate behavioural difference from the reference app

In the reference, `refreshAlerts()` runs automatically during the boot maintenance sweep.
v3's `app.js` does not carry that sweep, so derived alerts would silently go stale.

Rather than reintroduce **background Firestore writes on every launch** — unasked-for writes,
on a project that has already hit its free-tier read quota once — regenerating is an explicit
button on the Notifications screen. The trade is deliberate: alerts are fresh when someone
asks, instead of costing a write burst every time anyone opens the app.

### `js/ui/form.js` deliberately NOT copied

The reference account page opens its password dialog through `formOverlay()` — a 548-line v2
component library styled entirely against `components.css`, which this app has never loaded. Pulling both in for one two-field form would put v2's opaque-surface
component system inside a v3 glass screen. Written natively instead.

`setOwnPassword()` stays exactly as it is: it takes **no user id**, so this screen structurally
cannot be turned into a way to set somebody else's password. That constraint lives in
auth.service.js and was left there.

### Verified

- `node tools/verify-imports.cjs` → all imports resolve, nothing unreached.
- **Notifications:** four alerts render with correct severity icons, sorted
  unread-then-severity (error → warning → warning → success), the read row dimmed and last,
  announcements collapsed to a single banner, four filter pills, no horizontal overflow.
- **My account:** identity, facts, both sign-in methods read from `authMethods`, correct
  "Change password" vs "Set a password" label, theme options with the current one selected,
  14 permissions expanding from the banner, password form with two `minlength=8` fields.
- **Not verified:** `setOwnPassword()`, `markAllRead()`, `dismiss()` and `refreshAlerts()`
  against live Firestore — all four write.

## Stage 11 — Batches

### ⚠️ Never in the Claude Design project

Not lost — never drawn. Built from the v3 system.

### New

| Destination | Action |
|---|---|
| `js/modules/batches/batches.page.js` | **new** |
| `assets/css/v3.css` (appended) | seat-occupancy chips |

### Copied unmodified

**Nothing new** — `batches.service.js` arrived with Stage 7 (Timetable).

### The roster is sorted weakest-attendance-first

That ordering is `batchDetail()`'s own, not this page's, and it is the right one: reviewing a
batch, the question is who is slipping. Students with no marks sort last rather than first,
because "no data" is not "worst".

`findConflicts()` runs inside `batchDetail()`, so a double-booked room or teacher surfaces
without this page checking anything itself — which is why the detail leads with conflicts
rather than burying them.

### Create / edit / close not built

All three go through `createBatch()` / `updateBatch()` / `closeBatch()`, which carry an
`allowConflicts` override and (for closing) a `moveTo` target — closing a batch strands its
students otherwise. Those need a real form and a real confirm step; `js/ui/form.js` and
`js/ui/overlay.js` are still deliberately not copied. Buttons are present and disabled.

### Verified

- `node tools/verify-imports.cjs` → all imports resolve, nothing unreached.
- List: KPIs compute correctly (34 placed, 26 seats free, 1 unstaffed from a 3-batch fixture),
  seat chips full/open/empty, attendance chips banded 88% green / 61% red, 5 filter pills.
- Detail: conflict notice surfaces the room clash, metrics correct, roster ordered
  38% → 71% → 94% → "No marks", **inner clicks do not dismiss and the backdrop still does**
  (the Stage 8 scrim pattern, written correctly first time here).
- **Not verified:** nothing on this screen writes, so there is nothing outstanding.

## Stage 12 — Settings

### The one lost design whose structure survived

`Settings.dc.html` is gone, but the design project's change log recorded it:

> "tabbed Institute/Branches/Fee plans/Curriculum/Users/Roles/Preferences/Audit log/Data,
> role-gated (Teacher hides Users/Audit log/Data per the real capability model)"

All nine tabs, in that order, with that gating — and the gating is the **real capability
model**, not a role check. Each tab names a CAPABILITIES string and `visibleTabs()` filters on
`session.can()`. Verified across all three staff roles:

| Role | Tabs |
|---|---|
| Administrator | all 9 |
| Owner & Accountant | all 9 |
| **Teacher & Reception** | **6 — Users, Audit log and Data absent** |

No role is named anywhere in the filtering. Teacher & Reception simply lacks `user.view`,
`audit.view` and the backup/export/restore trio.

### New

| Destination | Action |
|---|---|
| `js/modules/settings/settings.page.js` | **new** — nine tabs, per-tab lazy loading |
| `assets/css/v3.css` (appended) | page-level tabs, and the role matrix — **the only table in either app** |

### Copied unmodified

`js/services/settings.service.js`, and `js/data/academicYears.repository.firestore.js` —
the repository removed in Stage 3 as unreached. That is the "add it when the module that needs
it arrives" rule working as intended, not a reversal.

### Reads everything, writes only Preferences

Every other write in `settings.service.js` needs a real form, and several carry guardrails
worth respecting rather than reimplementing hastily. The sharpest:
`requireRoleManagement()` — the Owner may create users but may **not** mint an Administrator,
or every Administrator-only capability would be one click from self-granted. Those arrive with
the form layer; buttons are present and disabled.

Per-tab lazy loading is deliberate: Settings is the one screen where loading everything up
front would be a genuinely wasteful read burst across nine collections.

### The Data tab states an open decision rather than promising a feature

Backup/restore runs through `backup.service.js`, which still reads and writes **IndexedDB**
for compatibility with pre-Firestore backup files. v3 has no IndexedDB at all. The tab lays
out the two options (carry the compatibility, or support only Firestore-era backups) and says
the previous app still handles backups against the same Firebase project meanwhile. This has
been an open question since Stage 0 and is now visible in the product, not just the checklist.

### Verified

- `node tools/verify-imports.cjs` → 69 modules, all resolve, nothing unreached. **The checker
  caught two missing dependencies during this stage** (`settings.service.js`, then
  `academicYears# Migration checklist — natyam-admin

Source project: `D:\Shanki\Natyam\Projects\Natyam-ERP-UAT` (read-only reference throughout;
nothing in it was ever edited). Rows are added as files are actually touched, not
reconstructed after the fact. See `composed-popping-ritchie.md` (the approved plan) for the
rules this follows.

## Stage 0 — bootstrap skeleton, no feature modules

| Source path | Destination path | Action | Notes |
|---|---|---|---|
| `js/config/firebase.config.js` | same | copied as-is | same Firebase project (`natyam-erp`) as both new apps |
| `js/config/app.config.js` | same | trimmed | removed `NAVIGATION`/`ROUTES` exports (this app defines its own nav table separately, not yet added — see Stage 1); kept `APP`, `SESSION`, `SCHEMA`/`STORE_NAMES`, domain status enums, `CAPABILITIES`, `ROLES`, curriculum/role resolution helpers, `PREFERENCE_DEFAULTS` |
| `js/core/bus.js` | same | copied as-is | generic infra |
| `js/core/firebase.js` | same | copied as-is | generic infra |
| `js/core/session.js` | same | copied as-is | generic infra |
| `js/core/repository.js` | — | **excluded** | dead code for this app: no Firestore repository imports it (all import Firestore SDK + `core/firebase.js` directly); it only backs the archived IndexedDB repositories |
| `js/core/db.js` | — | **excluded** | IndexedDB is fully retired for every store this app uses; only `backup.service.js` (not yet migrated) and dev-only `seed.js`/archive files still reference it in the reference project — revisit when Settings/Data (backup & restore) is migrated, see open question below |
| `js/utils/date.js` | same | copied as-is | used by users/branches/sessions/auditLog repositories |
| `js/utils/id.js` | same | copied as-is | used by auditLog repository |
| `js/utils/dom.js` | same | copied as-is | used by login page (`html`/`render`/`on`/`raw`/`formData`) |
| `js/utils/csv.js`, `money.js` | — | **excluded (for now)** | no Stage 0 code needs them; added when a module that does is migrated |
| `js/data/sequenceGenerator.firestore.js` | same | copied as-is | used by users repository |
| `js/data/users.repository.firestore.js` | same | copied as-is | |
| `js/data/branches.repository.firestore.js` | same | copied as-is | |
| `js/data/sessions.repository.firestore.js` | same | copied as-is | login-session records, not Timetable class sessions (confusingly similar name — see `js/services/session.service.js` in the reference project, which is Timetable-only and is *not* copied here) |
| `js/data/auditLog.repository.firestore.js` | same | copied as-is | |
| `js/data/repositories.js` | same | **trimmed** | only re-exports `branches$`, `users$`, `authMethodsOf` — the reference file re-exports 28 entities |
| `js/services/auth.service.js` | same | copied as-is | |
| `js/services/auth/providers/{google,password,mobileOtp}Provider.js` | same | copied as-is | |
| `js/modules/auth/login.page.js` | same | copied as-is | not yet redesigned — login/landing has no `.dc.html` in the Design project yet |
| `assets/css/{tokens,base,auth}.css` | same | copied as-is | `components.css` and `shell.css`/mobile-shell CSS **excluded for now** — no module needs them yet |
| `assets/img/brand/*`, `assets/icons/*` | same | copied as-is | |
| `firestore.rules` | same | copied as-is | **canonical copy** — rules changes are authored here, mirrored to `natyam-mobile`'s reference copy |
| `docs/architecture/`, `docs/migrations/` | same | copied as-is | reference documentation |
| — | `js/app.js` | **new** | minimal boot: Firebase auth watch → `resolveProvisionedUser` → desktop role gate (administrator/owner_accountant/viewer; teacher_reception turned away) → session hydrate → placeholder authenticated screen. No router, no Shell, no idle-timer, no command palette yet — those arrive with the first real module in Stage 1 |
| — | `index.html`, `manifest.json` | **new** | "Natyam ERP v3 — Admin" branding from the start (branding was originally planned as a separate Stage 2 pass, but since these two files are new-not-copied, there was no unbranded version to transition from — trivial to just write correctly the first time) |

**Open question, not yet resolved — raise when Settings/Data is migrated:** the reference
project's `backup.service.js` still reads/writes IndexedDB directly for legacy-backup-file
compatibility (`db.exportAll()`/`db.importAll()`, a `settings` store fallback). Whether
`natyam-admin`'s eventual Backup & Restore screen needs the same IndexedDB-era compatibility,
or can drop it since no device running this new app ever had IndexedDB data in the first
place, is a real decision — not made here.

## Stage 1 — Dashboard (+ the shell and navigation it needs)

The Dashboard is an aggregate view, so its dependency closure is the widest of any
module — it reads from most collections even though most *screens* do not exist yet. That
is the Dashboard's nature, not speculative copying: the closure below was computed from
its actual imports, not assumed.

### Redesigned (implemented from the approved Claude Design project)

| Source | Destination | Action | Notes |
|---|---|---|---|
| `js/ui/shell.js` | same | **redesigned per `Sidebar Navigation.dc.html`** | Accordion nav (one group open at a time, auto-opens the active group), 64px icon rail, in-sidebar jump search. Same 5 groups / same routes / same capability gating as v2 — chrome changed, structure did not. The v2 shell's Ctrl-K palette button became the design's jump filter; `palette.js` is therefore **not** copied. The v2 footer (backup status) is dropped — the design has no footer, so `backup.service.js` is not needed either |
| `js/modules/dashboard/dashboard.page.js` | same | **redesigned per `Dashboard.dc.html`** (desktop half) | KPI strip → Needs attention + Today → Money + The roll → Recent activity. Still computes nothing; every figure comes from `dashboard.service.js`. **Teacher-mode variant deliberately not implemented** — this app turns Teacher & Reception away, so `forTeacher()` is left unused here for natyam-mobile |
| — | `assets/css/v3.css` | **new** | The v3 design layer: warm glass on the school's stage artwork, in the design's own dark and light variants, wired to the existing `[data-theme]` preference. Values transcribed from the design files. `tokens.css` is untouched and still supplies type scale, spacing, radii, motion, z-index |
| — | `js/config/navigation.js` | **new** | This app's own nav/route table (not shared with mobile). `load: null` marks a module as not-yet-migrated; migrating one is a one-line change here |
| — | `js/modules/system/pending.page.js` | **new** | Honest placeholder for the 14 routes whose modules have not moved yet, so the full five-group sidebar can render without broken imports |
| — | `tools/verify-imports.cjs` | **new** | Static import checker. With no build step nothing else validates the module graph; run `node tools/verify-imports.cjs` after every module |

### Copied unmodified (business logic preserved exactly)

| Source | Action | Notes |
|---|---|---|
| `js/core/router.js` | copied as-is | |
| `js/services/{dashboard,admissions,attendance,audit,fees,finance,notifications,session}.service.js` | copied as-is | `session.service.js` here is **Timetable class sessions**, not login sessions |
| `js/data/{students,batches,admissions,invoices,payments,programs,attendance,staff,holidays,drafts,feePlans,settings,ledger,expenses,salaries,notifications,certificates,classSessions}.repository.firestore.js` | copied as-is | 18 repositories, all named by the closure above |
| `js/ui/{icons,toast}.js`, `js/utils/money.js` | copied as-is | |
| `js/data/repositories.js` | **extended** | Now re-exports the ~30 names this closure imports (was 3 after Stage 0). Still far short of the reference file's full re-export |

### Excluded / removed in this stage

| File | Action | Why |
|---|---|---|
| `js/ui/chart.js` | copied, then **removed** | The v3 design draws its income bars and level meters in CSS, so nothing imported it. Will return with Analytics/Reports, which need real SVG charts |
| `js/ui/palette.js` | **excluded** | The design replaces the Ctrl-K palette with an in-sidebar jump filter |
| `js/services/backup.service.js` | **excluded** | Only the v2 shell footer used it; the v3 shell has no footer. Returns with Settings → Data |
| `js/modules/dashboard`'s teacher view | **not ported** | Belongs to natyam-mobile (see above) |
| `assets/css/components.css` | still **excluded** | No migrated screen needs v2's opaque-surface component styles yet. It comes in with the first module that does — likely Students (tables) — at which point its glass treatment gets specified by `Students.dc.html` |

### Verified

- `node tools/verify-imports.cjs` → 54 modules reached, all imports resolve, no missing named exports, nothing unreached.
- Browser: app boots, login screen renders, no console errors.
- Shell rendered under a harnessed Owner & Accountant session: 5 accordion groups, exclusive open, auto-open on the active route, jump search filters to matching pages and auto-opens their group, icon rail hides labels while keeping every item reachable, branch switcher populated, theme toggle switches between the design's dark and light variants.
- Dashboard view rendered against data shaped like `overview()`'s real output: 5 tone-coded KPIs, all five design sections, 6 income bars, 4 level meters, 3 register-state badges.
- **Not verified:** a real signed-in session against live Firestore — that needs real credentials. The unauthenticated path was exercised and correctly refuses to render any route.

## Stage 2 — natyam-mobile shell + Dashboard

No change to this repo. See `natyam-mobile/MIGRATION_CHECKLIST.md`. Re-verified here after
that stage: still boots, no console errors.

## Stage 3 — Students

### Redesigned / new

| Source | Destination | Action | Notes |
|---|---|---|---|
| `js/modules/students/students.page.js` | same | **redesigned per `Students.dc.html`** (desktop half) | Two deliberate departures from v2, both from the design: the roll is a **compact card list, not a `<table>`**, and the profile is a **centred modal, not the right-side drawer**. The design project's own change log records the modal swap as a direct request, so it is not an artefact of the mock |
| — | `assets/css/v3.css` (appended) | **new section** | Roll list, filter bar, pills, profile modal, metrics/notices/facts |

### Copied unmodified

`js/services/students.service.js`, plus `js/data/{curricula,documents}.repository.firestore.js`.
`repositories.js` extended with `curricula$` and `documents$` only.

### Excluded / removed

| File | Action | Why |
|---|---|---|
| `js/data/academicYears.repository.firestore.js` | copied, then **removed** | My closure tool over-reported: it followed the *reference* `repositories.js`, which re-exports every entity. This repo's trimmed version does not, so nothing reached it. Returns with Settings |
| `js/data/curriculumLevels.repository.firestore.js` | copied, then **removed** | Same reason |
| `assets/css/components.css` | still **excluded** | The design's roll is a card list, so there is still no table to style. This is the module that would have pulled `components.css` in, and it did not |

### Not wired (drawn, but deliberately inert)

The profile's operation buttons — Move batch, Collect fee, Promote, Status, Issue certificate —
and Edit/Add student are rendered per the design but **disabled with a tooltip**, because each
needs its own form or confirm flow and several depend on modules that have not migrated (Fees,
Certificates). Shown-but-disabled beats live buttons that silently do nothing.

### Verified

- `node tools/verify-imports.cjs` → 58 modules, all resolve, nothing unreached.
- Roll: 3 rows, correct fee chips (`Paid up` / `₹3,500 overdue` / `₹1,500 due`) and status
  chips, filter bar with all four pills, live count subtitle.
- Profile modal: title/subtitle, all five ops present **and all disabled**, six tabs with
  Overview selected, three metrics, both notices (no-batch + medical), facts list.
- Nav: Students now `data-pending="false"`; pending count 14 → 13.
- **Bug found and fixed (affects both apps):** the design's "light" variant keeps *white* type
  (`nameColor: #FFFFFF`) — it is lighter glass on a dark photo, not a light theme. I had
  mirrored its `scrim: rgba(255,248,239,0.22)`, which *lightens* the backdrop and left white
  text washed out over the bright part of the artwork. The scrim now darkens in both variants;
  only the glass above it lightens.

## Stage 4 — Guardian Portal (natyam-mobile only)

No change to this repo. See `natyam-mobile/MIGRATION_CHECKLIST.md`.

## Stage 5 — Attendance (the register)

### ⚠️ Built without an approved design

The Claude Design project was deleted before `Attendance.dc.html` could be retrieved (see
`docs/design/README.md`), and Claude Design could not regenerate it. On the user's explicit
instruction, this screen was built directly rather than waiting. That was a smaller risk than
it sounds, because neither half was invented:

- **The interaction is ported.** v2's `attendance.page.js` states its own rule — *"built for
  one-handed speed: everybody starts present, marking is one tap"* — and that is preserved
  exactly, along with All present / All absent. A teacher who used v2 relearns nothing.
- **The visual language is the implemented v3 system** in `assets/css/v3.css`, already proven
  on Dashboard and Students.

**If `Attendance.dc.html` is ever recovered, this is the file to reconcile against it.** The
business logic underneath is untouched, so that would be a markup-and-CSS change.

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/attendance/attendance.page.js` | **new** | Two views: the day board (every batch meeting on a date, done/rate, missing-registers card with count badge) and the register itself |
| `assets/css/v3.css` (appended) | **new section** | Roster rows, the present/absent states, the save bar |

### Copied unmodified

`js/services/attendance.service.js` and `js/services/session.service.js` were already present
from Stage 1 (the Dashboard's closure). **No new files were needed** — Attendance's entire
dependency closure was already satisfied.

### Design decisions worth naming

- **Present is quiet; absent shouts.** A teacher scanning a roster should see the *absences*,
  not forty equally-loud rows. Present is a hairline green edge; absent is a filled red row.
- **One tap re-renders one row**, not the roster. Repainting everything would lose scroll
  position — unacceptable when working down a list of forty.
- **The marking-window rule is the service's**, asked via `markingWindow()` before the UI
  offers to save, never re-implemented here. No future dates; nothing older than 30 days.
- **Postpone / Cancel class / Class calendar are drawn but disabled.** Each needs a reason and
  (for postpone) a replacement date — real forms that belong with Timetable.
- **Attendance was temporarily un-hidden in the sidebar.** The reference app hides it and
  reaches it from Timetable's "Take register" (Milestone B2). Timetable has not migrated, so
  hiding it would leave the register reachable only by typing a URL. **Restore `hidden: true`
  in `js/config/navigation.js` when Timetable lands.**

### Verified

- `node tools/verify-imports.cjs` → 59 modules, all resolve, nothing unreached.
- Day board: 3 classes with correct badges (`92% present` / `Not marked`), missing-registers
  card with count `2` and per-row Mark buttons, date navigation and Today.
- Register: roster renders, everyone starts present, **one tap flips exactly one student**
  (verified DOM *and* in-memory model agree after two independent taps), tally updates, bulk
  actions work, class-ops correctly disabled, rows ≥62px.
- **A false alarm worth recording:** an intermediate screenshot appeared to show the *wrong*
  student marked absent. Investigated rather than dismissed — it was cross-contamination from
  a failed earlier harness leaving a second page instance bound to the same container, not a
  product defect. Re-tested on a clean page: correct.
- **Not verified:** `postRegister()` against live Firestore. This is v3's **first write path**,
  and it has only been exercised up to the service call — the save itself needs a real
  signed-in teacher.

## Stage 6 — Admissions

### ⚠️ Built without an approved design

`Admissions.dc.html` was lost with the design project (see `docs/design/README.md`). Built
directly on the user's instruction. As with Attendance, neither half was invented:

- **The workflow is the service's, not this page's.** `nextActionFor()` in
  `admissions.service.js` already defines exactly one next step per status — draft→submit,
  submitted→review, reviewing→approve, approved→enrol, rejected→reopen, enrolled→nothing. The
  page renders that ladder; it does not decide it.
- **The visual language is the implemented v3 system**, proven across three prior screens.

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/admissions/admissions.page.js` | **new** | Pipeline stats, status filter pills, application list, detail modal carrying the ladder |
| `assets/css/v3.css` (appended) | **new section** | Status chips + pipeline card sizing |

### Copied unmodified

**Nothing new.** `admissions.service.js` arrived with Stage 1's Dashboard closure, and its
whole dependency closure was already satisfied.

### What works, and what does not

**Working end to end:** Begin review → Approve → Enrol (with a batch picker fed by the
service's own `eligibleBatches`), plus Reject with a required reason and Reopen. Capability
gating mirrors the service's `session.require()` calls exactly, so the UI never offers what
the service will refuse.

**Not built:** taking a *new* application. Intake is a multi-step wizard (`ADMISSION_STEPS` +
`validateStep` + `saveDraft`) that deserves its own stage; `js/ui/wizard.js` is deliberately
still not copied in. The button is present and disabled with an explanation. What this screen
does is the daily job — processing what has already arrived.

### Verified

- `node tools/verify-imports.cjs` → 60 modules, all resolve, nothing unreached.
- List: six pipeline stat cards with correct tones, six filter pills, four applications with
  correctly coloured status chips, and the "waiting 13d" stall flag on the one stalled row.
- **The ladder, tested across every status** — submitted → *Begin review* (+ Reject);
  reviewing → *Approve* (+ Reject); approved → *Enrol* with the batch picker appearing and
  Reject correctly **absent**; enrolled → no action, closed note; rejected → *Reopen*. Matches
  `nextActionFor()` exactly.
- **A permission finding, confirmed not a bug:** Teacher & Reception shows `admission.approve`
  as granted. Checked against `ROLES` — it genuinely holds that capability, because it is a
  combined teaching *and reception* role and reception processes admissions. The UI is correct
  to enable it.
- **Not verified:** any of the write paths (`beginReview`, `approve`, `reject`,
  `enrolApplicant`, `reopen`) against live Firestore.

## Stage 7 — Timetable (and restoring Attendance's entry point)

### ⚠️ Built without the design file — but one instruction survived

`Timetable.dc.html` was lost, but the design project's own change log (preserved in
`docs/design/README.md`) recorded two decisions about it, and both are honoured:

> "weekly grid (Desktop) and day-picker + agenda (Mobile)"
> "tiles … now show only the batch name and time slot — dropped the stacked curriculum
> levels / teacher / room line, matching v2.25.0's tile simplification"

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/batches/timetable.page.js` | **new** | Seven-column week, five slot states, legend, week navigation |
| `assets/css/v3.css` (appended) | **new section** | Week grid, slot tiles and states, legend |

### Copied unmodified

`js/services/batches.service.js` — **caught by the import checker**, not by inspection: the
first verify run after writing the page failed with `MISSING FILE … batches.service.js`. Its
own closure was already satisfied.

### Attendance's entry point restored

`/attendance` is **`hidden: true` again**, matching the reference app (Milestone B2). Timetable
tiles now link to `#/attendance?date=…&batch=…`, and both Attendance pages consume that
`batch` param **once**, on first load — so "All classes" afterwards genuinely returns to the
day board instead of bouncing back into the register.

### One departure from the design instruction, and why

Tile names **wrap to two lines** rather than truncating. Seven columns leaves ~125px per tile,
and "Foundation Level 1" does not fit on one line at that width — the ellipsis turned every
tile into "Foundation Lev…", which tells a reader nothing. The instruction was *name + time*;
it did not ask for an unreadable name. Two lines is the cap, past which a tile starts becoming
the paragraph v2.25.0 removed. Caught in visual review, not by a test.

### Verified

- `node tools/verify-imports.cjs` → 62 modules, all resolve, nothing unreached.
- Seven day columns; every tile exactly two lines (name + time); all five states correct —
  marked, needs-marking, upcoming, cancelled (disabled), replacement; five legend items; week
  navigation and "This week"; today's column carries the accent edge.
- After the wrap fix: no tile name clipped.

## Stage 8 — Fee collection

### ⚠️ No design existed for this screen at all

Unlike Attendance and Timetable, Fees was **never part of the Claude Design project** — there
is not even a lost file to reconcile against later. Built from the v3 system already proven
across five screens.

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/fees/fees.page.js` | **new** | Month summary, ageing breakdown, filters, student worklist, per-student ledger, inline collect form |
| `assets/css/v3.css` (appended) | **new section** | Ageing cells, invoice rows, the payment form |

### Copied unmodified

**Nothing new** — `fees.service.js` arrived with Stage 1's Dashboard closure.

### Model: student-centric, not invoice-centric

Carried over from the reference app deliberately. A school collects money from a **person
standing at a desk**, not from an invoice number — so the list is students who owe (sorted by
who owes most and longest, because it is a worklist), and opening one shows their invoices,
their receipts, and the form to take money against a specific invoice.

The collect form expands **under the invoice it belongs to** rather than in a second dialog:
the amount and the balance it settles must be readable at the same time, or somebody will
collect against the wrong invoice.

The form mirrors the service's validation where it is cheap (max = balance, mode list,
conditional reference field, no future date) but **never replaces it** — `recordPayment()`
re-validates everything and remains the authority.

### Verified against live Firestore

- Month summary, ageing (₹2.59L at 1–30 days, ₹25K at 31–60, ₹0 not-yet-due), 157 real rows.
- `?filter=overdue` deep link from the Dashboard's "Chase payments" lands correctly.
- Opened a real student: billed/collected/outstanding correct, overdue notice with the true
  oldest due date, real invoice number and due date.
- Collect form: amount defaults to the balance and is capped at it, reference is required for
  UPI and **hidden for Cash**, "balance after this" tracks a part payment (₹2,000 − ₹500 =
  ₹1,500), received-on capped at today.
- **`recordPayment()` was deliberately NOT submitted** — this is real money against real
  records, and that is the user's call to make.

---

## 🐛 Two bugs found by testing on live data (both fixed)

### 1. Modals dismissed when you clicked inside them

The backdrop carried the close action **and wrapped the dialog**, so the delegated
`closest('[data-action="close-…"]')` match resolved *any* click inside the modal to the
backdrop. Clicking a tab, a form field or the Collect button silently closed the dialog. The
`stopPropagation()` guard was useless: both handlers are delegated on the same root node, so
the event has already reached it.

Fixed by giving the backdrop `data-role="scrim"` and comparing `event.target` to the matched
element — distinguishing "clicked the backdrop" from "clicked something the backdrop
contains". Affected **all three desktop modals** (Students, Admissions, Fees). Mobile was
never affected: there the scrim is rendered as a *sibling* of the sheet, not a parent.

### 2. Every page leaked its event listeners onto the next page

`on()` binds to the page container, which the router **renders into rather than replaces**, so
a listener that is never disposed outlives its page. The reference project wraps every such
call in `this.onDispose(...)`; none of the v3 pages did.

Symptom, caught from a stray URL in a diagnostic: clicking a row on **Fee collection** fired
the previous **Timetable** page's handler and navigated to
`#/attendance?date=undefined&batch=undefined`. Both pages use `data-action="open"`, so the
stale handler matched.

**64 unwrapped listeners across 9 page files, in both apps** — every page written so far.
All now wrapped, matching the reference pattern. Verified end to end: visiting Timetable then
Fees and clicking a row now stays on Fees.

## Stage 10 — Notifications + My account

### ⚠️ Neither screen was ever in the Claude Design project

Not lost like Attendance — never drawn at all. Built from the v3 system.

### New

| Destination | Action |
|---|---|
| `js/modules/notifications/notifications.page.js` | **new** |
| `js/modules/auth/profile.page.js` | **new** |
| `assets/css/v3.css` (appended) | **new sections** — alert rows, severity icons, identity card |

### Copied unmodified

**Nothing new.** `notifications.service.js` arrived with the Dashboard closure; the account
screen needs only `users# Migration checklist — natyam-admin

Source project: `D:\Shanki\Natyam\Projects\Natyam-ERP-UAT` (read-only reference throughout;
nothing in it was ever edited). Rows are added as files are actually touched, not
reconstructed after the fact. See `composed-popping-ritchie.md` (the approved plan) for the
rules this follows.

## Stage 0 — bootstrap skeleton, no feature modules

| Source path | Destination path | Action | Notes |
|---|---|---|---|
| `js/config/firebase.config.js` | same | copied as-is | same Firebase project (`natyam-erp`) as both new apps |
| `js/config/app.config.js` | same | trimmed | removed `NAVIGATION`/`ROUTES` exports (this app defines its own nav table separately, not yet added — see Stage 1); kept `APP`, `SESSION`, `SCHEMA`/`STORE_NAMES`, domain status enums, `CAPABILITIES`, `ROLES`, curriculum/role resolution helpers, `PREFERENCE_DEFAULTS` |
| `js/core/bus.js` | same | copied as-is | generic infra |
| `js/core/firebase.js` | same | copied as-is | generic infra |
| `js/core/session.js` | same | copied as-is | generic infra |
| `js/core/repository.js` | — | **excluded** | dead code for this app: no Firestore repository imports it (all import Firestore SDK + `core/firebase.js` directly); it only backs the archived IndexedDB repositories |
| `js/core/db.js` | — | **excluded** | IndexedDB is fully retired for every store this app uses; only `backup.service.js` (not yet migrated) and dev-only `seed.js`/archive files still reference it in the reference project — revisit when Settings/Data (backup & restore) is migrated, see open question below |
| `js/utils/date.js` | same | copied as-is | used by users/branches/sessions/auditLog repositories |
| `js/utils/id.js` | same | copied as-is | used by auditLog repository |
| `js/utils/dom.js` | same | copied as-is | used by login page (`html`/`render`/`on`/`raw`/`formData`) |
| `js/utils/csv.js`, `money.js` | — | **excluded (for now)** | no Stage 0 code needs them; added when a module that does is migrated |
| `js/data/sequenceGenerator.firestore.js` | same | copied as-is | used by users repository |
| `js/data/users.repository.firestore.js` | same | copied as-is | |
| `js/data/branches.repository.firestore.js` | same | copied as-is | |
| `js/data/sessions.repository.firestore.js` | same | copied as-is | login-session records, not Timetable class sessions (confusingly similar name — see `js/services/session.service.js` in the reference project, which is Timetable-only and is *not* copied here) |
| `js/data/auditLog.repository.firestore.js` | same | copied as-is | |
| `js/data/repositories.js` | same | **trimmed** | only re-exports `branches$`, `users$`, `authMethodsOf` — the reference file re-exports 28 entities |
| `js/services/auth.service.js` | same | copied as-is | |
| `js/services/auth/providers/{google,password,mobileOtp}Provider.js` | same | copied as-is | |
| `js/modules/auth/login.page.js` | same | copied as-is | not yet redesigned — login/landing has no `.dc.html` in the Design project yet |
| `assets/css/{tokens,base,auth}.css` | same | copied as-is | `components.css` and `shell.css`/mobile-shell CSS **excluded for now** — no module needs them yet |
| `assets/img/brand/*`, `assets/icons/*` | same | copied as-is | |
| `firestore.rules` | same | copied as-is | **canonical copy** — rules changes are authored here, mirrored to `natyam-mobile`'s reference copy |
| `docs/architecture/`, `docs/migrations/` | same | copied as-is | reference documentation |
| — | `js/app.js` | **new** | minimal boot: Firebase auth watch → `resolveProvisionedUser` → desktop role gate (administrator/owner_accountant/viewer; teacher_reception turned away) → session hydrate → placeholder authenticated screen. No router, no Shell, no idle-timer, no command palette yet — those arrive with the first real module in Stage 1 |
| — | `index.html`, `manifest.json` | **new** | "Natyam ERP v3 — Admin" branding from the start (branding was originally planned as a separate Stage 2 pass, but since these two files are new-not-copied, there was no unbranded version to transition from — trivial to just write correctly the first time) |

**Open question, not yet resolved — raise when Settings/Data is migrated:** the reference
project's `backup.service.js` still reads/writes IndexedDB directly for legacy-backup-file
compatibility (`db.exportAll()`/`db.importAll()`, a `settings` store fallback). Whether
`natyam-admin`'s eventual Backup & Restore screen needs the same IndexedDB-era compatibility,
or can drop it since no device running this new app ever had IndexedDB data in the first
place, is a real decision — not made here.

## Stage 1 — Dashboard (+ the shell and navigation it needs)

The Dashboard is an aggregate view, so its dependency closure is the widest of any
module — it reads from most collections even though most *screens* do not exist yet. That
is the Dashboard's nature, not speculative copying: the closure below was computed from
its actual imports, not assumed.

### Redesigned (implemented from the approved Claude Design project)

| Source | Destination | Action | Notes |
|---|---|---|---|
| `js/ui/shell.js` | same | **redesigned per `Sidebar Navigation.dc.html`** | Accordion nav (one group open at a time, auto-opens the active group), 64px icon rail, in-sidebar jump search. Same 5 groups / same routes / same capability gating as v2 — chrome changed, structure did not. The v2 shell's Ctrl-K palette button became the design's jump filter; `palette.js` is therefore **not** copied. The v2 footer (backup status) is dropped — the design has no footer, so `backup.service.js` is not needed either |
| `js/modules/dashboard/dashboard.page.js` | same | **redesigned per `Dashboard.dc.html`** (desktop half) | KPI strip → Needs attention + Today → Money + The roll → Recent activity. Still computes nothing; every figure comes from `dashboard.service.js`. **Teacher-mode variant deliberately not implemented** — this app turns Teacher & Reception away, so `forTeacher()` is left unused here for natyam-mobile |
| — | `assets/css/v3.css` | **new** | The v3 design layer: warm glass on the school's stage artwork, in the design's own dark and light variants, wired to the existing `[data-theme]` preference. Values transcribed from the design files. `tokens.css` is untouched and still supplies type scale, spacing, radii, motion, z-index |
| — | `js/config/navigation.js` | **new** | This app's own nav/route table (not shared with mobile). `load: null` marks a module as not-yet-migrated; migrating one is a one-line change here |
| — | `js/modules/system/pending.page.js` | **new** | Honest placeholder for the 14 routes whose modules have not moved yet, so the full five-group sidebar can render without broken imports |
| — | `tools/verify-imports.cjs` | **new** | Static import checker. With no build step nothing else validates the module graph; run `node tools/verify-imports.cjs` after every module |

### Copied unmodified (business logic preserved exactly)

| Source | Action | Notes |
|---|---|---|
| `js/core/router.js` | copied as-is | |
| `js/services/{dashboard,admissions,attendance,audit,fees,finance,notifications,session}.service.js` | copied as-is | `session.service.js` here is **Timetable class sessions**, not login sessions |
| `js/data/{students,batches,admissions,invoices,payments,programs,attendance,staff,holidays,drafts,feePlans,settings,ledger,expenses,salaries,notifications,certificates,classSessions}.repository.firestore.js` | copied as-is | 18 repositories, all named by the closure above |
| `js/ui/{icons,toast}.js`, `js/utils/money.js` | copied as-is | |
| `js/data/repositories.js` | **extended** | Now re-exports the ~30 names this closure imports (was 3 after Stage 0). Still far short of the reference file's full re-export |

### Excluded / removed in this stage

| File | Action | Why |
|---|---|---|
| `js/ui/chart.js` | copied, then **removed** | The v3 design draws its income bars and level meters in CSS, so nothing imported it. Will return with Analytics/Reports, which need real SVG charts |
| `js/ui/palette.js` | **excluded** | The design replaces the Ctrl-K palette with an in-sidebar jump filter |
| `js/services/backup.service.js` | **excluded** | Only the v2 shell footer used it; the v3 shell has no footer. Returns with Settings → Data |
| `js/modules/dashboard`'s teacher view | **not ported** | Belongs to natyam-mobile (see above) |
| `assets/css/components.css` | still **excluded** | No migrated screen needs v2's opaque-surface component styles yet. It comes in with the first module that does — likely Students (tables) — at which point its glass treatment gets specified by `Students.dc.html` |

### Verified

- `node tools/verify-imports.cjs` → 54 modules reached, all imports resolve, no missing named exports, nothing unreached.
- Browser: app boots, login screen renders, no console errors.
- Shell rendered under a harnessed Owner & Accountant session: 5 accordion groups, exclusive open, auto-open on the active route, jump search filters to matching pages and auto-opens their group, icon rail hides labels while keeping every item reachable, branch switcher populated, theme toggle switches between the design's dark and light variants.
- Dashboard view rendered against data shaped like `overview()`'s real output: 5 tone-coded KPIs, all five design sections, 6 income bars, 4 level meters, 3 register-state badges.
- **Not verified:** a real signed-in session against live Firestore — that needs real credentials. The unauthenticated path was exercised and correctly refuses to render any route.

## Stage 2 — natyam-mobile shell + Dashboard

No change to this repo. See `natyam-mobile/MIGRATION_CHECKLIST.md`. Re-verified here after
that stage: still boots, no console errors.

## Stage 3 — Students

### Redesigned / new

| Source | Destination | Action | Notes |
|---|---|---|---|
| `js/modules/students/students.page.js` | same | **redesigned per `Students.dc.html`** (desktop half) | Two deliberate departures from v2, both from the design: the roll is a **compact card list, not a `<table>`**, and the profile is a **centred modal, not the right-side drawer**. The design project's own change log records the modal swap as a direct request, so it is not an artefact of the mock |
| — | `assets/css/v3.css` (appended) | **new section** | Roll list, filter bar, pills, profile modal, metrics/notices/facts |

### Copied unmodified

`js/services/students.service.js`, plus `js/data/{curricula,documents}.repository.firestore.js`.
`repositories.js` extended with `curricula$` and `documents$` only.

### Excluded / removed

| File | Action | Why |
|---|---|---|
| `js/data/academicYears.repository.firestore.js` | copied, then **removed** | My closure tool over-reported: it followed the *reference* `repositories.js`, which re-exports every entity. This repo's trimmed version does not, so nothing reached it. Returns with Settings |
| `js/data/curriculumLevels.repository.firestore.js` | copied, then **removed** | Same reason |
| `assets/css/components.css` | still **excluded** | The design's roll is a card list, so there is still no table to style. This is the module that would have pulled `components.css` in, and it did not |

### Not wired (drawn, but deliberately inert)

The profile's operation buttons — Move batch, Collect fee, Promote, Status, Issue certificate —
and Edit/Add student are rendered per the design but **disabled with a tooltip**, because each
needs its own form or confirm flow and several depend on modules that have not migrated (Fees,
Certificates). Shown-but-disabled beats live buttons that silently do nothing.

### Verified

- `node tools/verify-imports.cjs` → 58 modules, all resolve, nothing unreached.
- Roll: 3 rows, correct fee chips (`Paid up` / `₹3,500 overdue` / `₹1,500 due`) and status
  chips, filter bar with all four pills, live count subtitle.
- Profile modal: title/subtitle, all five ops present **and all disabled**, six tabs with
  Overview selected, three metrics, both notices (no-batch + medical), facts list.
- Nav: Students now `data-pending="false"`; pending count 14 → 13.
- **Bug found and fixed (affects both apps):** the design's "light" variant keeps *white* type
  (`nameColor: #FFFFFF`) — it is lighter glass on a dark photo, not a light theme. I had
  mirrored its `scrim: rgba(255,248,239,0.22)`, which *lightens* the backdrop and left white
  text washed out over the bright part of the artwork. The scrim now darkens in both variants;
  only the glass above it lightens.

## Stage 4 — Guardian Portal (natyam-mobile only)

No change to this repo. See `natyam-mobile/MIGRATION_CHECKLIST.md`.

## Stage 5 — Attendance (the register)

### ⚠️ Built without an approved design

The Claude Design project was deleted before `Attendance.dc.html` could be retrieved (see
`docs/design/README.md`), and Claude Design could not regenerate it. On the user's explicit
instruction, this screen was built directly rather than waiting. That was a smaller risk than
it sounds, because neither half was invented:

- **The interaction is ported.** v2's `attendance.page.js` states its own rule — *"built for
  one-handed speed: everybody starts present, marking is one tap"* — and that is preserved
  exactly, along with All present / All absent. A teacher who used v2 relearns nothing.
- **The visual language is the implemented v3 system** in `assets/css/v3.css`, already proven
  on Dashboard and Students.

**If `Attendance.dc.html` is ever recovered, this is the file to reconcile against it.** The
business logic underneath is untouched, so that would be a markup-and-CSS change.

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/attendance/attendance.page.js` | **new** | Two views: the day board (every batch meeting on a date, done/rate, missing-registers card with count badge) and the register itself |
| `assets/css/v3.css` (appended) | **new section** | Roster rows, the present/absent states, the save bar |

### Copied unmodified

`js/services/attendance.service.js` and `js/services/session.service.js` were already present
from Stage 1 (the Dashboard's closure). **No new files were needed** — Attendance's entire
dependency closure was already satisfied.

### Design decisions worth naming

- **Present is quiet; absent shouts.** A teacher scanning a roster should see the *absences*,
  not forty equally-loud rows. Present is a hairline green edge; absent is a filled red row.
- **One tap re-renders one row**, not the roster. Repainting everything would lose scroll
  position — unacceptable when working down a list of forty.
- **The marking-window rule is the service's**, asked via `markingWindow()` before the UI
  offers to save, never re-implemented here. No future dates; nothing older than 30 days.
- **Postpone / Cancel class / Class calendar are drawn but disabled.** Each needs a reason and
  (for postpone) a replacement date — real forms that belong with Timetable.
- **Attendance was temporarily un-hidden in the sidebar.** The reference app hides it and
  reaches it from Timetable's "Take register" (Milestone B2). Timetable has not migrated, so
  hiding it would leave the register reachable only by typing a URL. **Restore `hidden: true`
  in `js/config/navigation.js` when Timetable lands.**

### Verified

- `node tools/verify-imports.cjs` → 59 modules, all resolve, nothing unreached.
- Day board: 3 classes with correct badges (`92% present` / `Not marked`), missing-registers
  card with count `2` and per-row Mark buttons, date navigation and Today.
- Register: roster renders, everyone starts present, **one tap flips exactly one student**
  (verified DOM *and* in-memory model agree after two independent taps), tally updates, bulk
  actions work, class-ops correctly disabled, rows ≥62px.
- **A false alarm worth recording:** an intermediate screenshot appeared to show the *wrong*
  student marked absent. Investigated rather than dismissed — it was cross-contamination from
  a failed earlier harness leaving a second page instance bound to the same container, not a
  product defect. Re-tested on a clean page: correct.
- **Not verified:** `postRegister()` against live Firestore. This is v3's **first write path**,
  and it has only been exercised up to the service call — the save itself needs a real
  signed-in teacher.

## Stage 6 — Admissions

### ⚠️ Built without an approved design

`Admissions.dc.html` was lost with the design project (see `docs/design/README.md`). Built
directly on the user's instruction. As with Attendance, neither half was invented:

- **The workflow is the service's, not this page's.** `nextActionFor()` in
  `admissions.service.js` already defines exactly one next step per status — draft→submit,
  submitted→review, reviewing→approve, approved→enrol, rejected→reopen, enrolled→nothing. The
  page renders that ladder; it does not decide it.
- **The visual language is the implemented v3 system**, proven across three prior screens.

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/admissions/admissions.page.js` | **new** | Pipeline stats, status filter pills, application list, detail modal carrying the ladder |
| `assets/css/v3.css` (appended) | **new section** | Status chips + pipeline card sizing |

### Copied unmodified

**Nothing new.** `admissions.service.js` arrived with Stage 1's Dashboard closure, and its
whole dependency closure was already satisfied.

### What works, and what does not

**Working end to end:** Begin review → Approve → Enrol (with a batch picker fed by the
service's own `eligibleBatches`), plus Reject with a required reason and Reopen. Capability
gating mirrors the service's `session.require()` calls exactly, so the UI never offers what
the service will refuse.

**Not built:** taking a *new* application. Intake is a multi-step wizard (`ADMISSION_STEPS` +
`validateStep` + `saveDraft`) that deserves its own stage; `js/ui/wizard.js` is deliberately
still not copied in. The button is present and disabled with an explanation. What this screen
does is the daily job — processing what has already arrived.

### Verified

- `node tools/verify-imports.cjs` → 60 modules, all resolve, nothing unreached.
- List: six pipeline stat cards with correct tones, six filter pills, four applications with
  correctly coloured status chips, and the "waiting 13d" stall flag on the one stalled row.
- **The ladder, tested across every status** — submitted → *Begin review* (+ Reject);
  reviewing → *Approve* (+ Reject); approved → *Enrol* with the batch picker appearing and
  Reject correctly **absent**; enrolled → no action, closed note; rejected → *Reopen*. Matches
  `nextActionFor()` exactly.
- **A permission finding, confirmed not a bug:** Teacher & Reception shows `admission.approve`
  as granted. Checked against `ROLES` — it genuinely holds that capability, because it is a
  combined teaching *and reception* role and reception processes admissions. The UI is correct
  to enable it.
- **Not verified:** any of the write paths (`beginReview`, `approve`, `reject`,
  `enrolApplicant`, `reopen`) against live Firestore.

## Stage 7 — Timetable (and restoring Attendance's entry point)

### ⚠️ Built without the design file — but one instruction survived

`Timetable.dc.html` was lost, but the design project's own change log (preserved in
`docs/design/README.md`) recorded two decisions about it, and both are honoured:

> "weekly grid (Desktop) and day-picker + agenda (Mobile)"
> "tiles … now show only the batch name and time slot — dropped the stacked curriculum
> levels / teacher / room line, matching v2.25.0's tile simplification"

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/batches/timetable.page.js` | **new** | Seven-column week, five slot states, legend, week navigation |
| `assets/css/v3.css` (appended) | **new section** | Week grid, slot tiles and states, legend |

### Copied unmodified

`js/services/batches.service.js` — **caught by the import checker**, not by inspection: the
first verify run after writing the page failed with `MISSING FILE … batches.service.js`. Its
own closure was already satisfied.

### Attendance's entry point restored

`/attendance` is **`hidden: true` again**, matching the reference app (Milestone B2). Timetable
tiles now link to `#/attendance?date=…&batch=…`, and both Attendance pages consume that
`batch` param **once**, on first load — so "All classes" afterwards genuinely returns to the
day board instead of bouncing back into the register.

### One departure from the design instruction, and why

Tile names **wrap to two lines** rather than truncating. Seven columns leaves ~125px per tile,
and "Foundation Level 1" does not fit on one line at that width — the ellipsis turned every
tile into "Foundation Lev…", which tells a reader nothing. The instruction was *name + time*;
it did not ask for an unreadable name. Two lines is the cap, past which a tile starts becoming
the paragraph v2.25.0 removed. Caught in visual review, not by a test.

### Verified

- `node tools/verify-imports.cjs` → 62 modules, all resolve, nothing unreached.
- Seven day columns; every tile exactly two lines (name + time); all five states correct —
  marked, needs-marking, upcoming, cancelled (disabled), replacement; five legend items; week
  navigation and "This week"; today's column carries the accent edge.
- After the wrap fix: no tile name clipped.

## Stage 8 — Fee collection

### ⚠️ No design existed for this screen at all

Unlike Attendance and Timetable, Fees was **never part of the Claude Design project** — there
is not even a lost file to reconcile against later. Built from the v3 system already proven
across five screens.

### New

| Destination | Action | Notes |
|---|---|---|
| `js/modules/fees/fees.page.js` | **new** | Month summary, ageing breakdown, filters, student worklist, per-student ledger, inline collect form |
| `assets/css/v3.css` (appended) | **new section** | Ageing cells, invoice rows, the payment form |

### Copied unmodified

**Nothing new** — `fees.service.js` arrived with Stage 1's Dashboard closure.

### Model: student-centric, not invoice-centric

Carried over from the reference app deliberately. A school collects money from a **person
standing at a desk**, not from an invoice number — so the list is students who owe (sorted by
who owes most and longest, because it is a worklist), and opening one shows their invoices,
their receipts, and the form to take money against a specific invoice.

The collect form expands **under the invoice it belongs to** rather than in a second dialog:
the amount and the balance it settles must be readable at the same time, or somebody will
collect against the wrong invoice.

The form mirrors the service's validation where it is cheap (max = balance, mode list,
conditional reference field, no future date) but **never replaces it** — `recordPayment()`
re-validates everything and remains the authority.

### Verified against live Firestore

- Month summary, ageing (₹2.59L at 1–30 days, ₹25K at 31–60, ₹0 not-yet-due), 157 real rows.
- `?filter=overdue` deep link from the Dashboard's "Chase payments" lands correctly.
- Opened a real student: billed/collected/outstanding correct, overdue notice with the true
  oldest due date, real invoice number and due date.
- Collect form: amount defaults to the balance and is capped at it, reference is required for
  UPI and **hidden for Cash**, "balance after this" tracks a part payment (₹2,000 − ₹500 =
  ₹1,500), received-on capped at today.
- **`recordPayment()` was deliberately NOT submitted** — this is real money against real
  records, and that is the user's call to make.

---

## 🐛 Two bugs found by testing on live data (both fixed)

### 1. Modals dismissed when you clicked inside them

The backdrop carried the close action **and wrapped the dialog**, so the delegated
`closest('[data-action="close-…"]')` match resolved *any* click inside the modal to the
backdrop. Clicking a tab, a form field or the Collect button silently closed the dialog. The
`stopPropagation()` guard was useless: both handlers are delegated on the same root node, so
the event has already reached it.

Fixed by giving the backdrop `data-role="scrim"` and comparing `event.target` to the matched
element — distinguishing "clicked the backdrop" from "clicked something the backdrop
contains". Affected **all three desktop modals** (Students, Admissions, Fees). Mobile was
never affected: there the scrim is rendered as a *sibling* of the sheet, not a parent.

### 2. Every page leaked its event listeners onto the next page

`on()` binds to the page container, which the router **renders into rather than replaces**, so
a listener that is never disposed outlives its page. The reference project wraps every such
call in `this.onDispose(...)`; none of the v3 pages did.

Symptom, caught from a stray URL in a diagnostic: clicking a row on **Fee collection** fired
the previous **Timetable** page's handler and navigated to
`#/attendance?date=undefined&batch=undefined`. Both pages use `data-action="open"`, so the
stale handler matched.

**64 unwrapped listeners across 9 page files, in both apps** — every page written so far.
All now wrapped, matching the reference pattern. Verified end to end: visiting Timetable then
Fees and clicking a row now stays on Fees.

, `authMethodsOf` and `setOwnPassword`, all already present.

### Severity is the service's, not the page's

`centre()` maps each row to error / warning / success / info on its own stated grounds —
*"what must I deal with" is the question being asked and the kind is only a hint towards the
answer*. These pages sort unread-then-severity-then-newest and render that mapping; they do
not re-derive it.

### ⚠️ One deliberate behavioural difference from the reference app

In the reference, `refreshAlerts()` runs automatically during the boot maintenance sweep.
v3's `app.js` does not carry that sweep, so derived alerts would silently go stale.

Rather than reintroduce **background Firestore writes on every launch** — unasked-for writes,
on a project that has already hit its free-tier read quota once — regenerating is an explicit
button on the Notifications screen. The trade is deliberate: alerts are fresh when someone
asks, instead of costing a write burst every time anyone opens the app.

### `js/ui/form.js` deliberately NOT copied

The reference account page opens its password dialog through `formOverlay()` — a 548-line v2
component library styled entirely against `components.css`, which this app has never loaded. Pulling both in for one two-field form would put v2's opaque-surface
component system inside a v3 glass screen. Written natively instead.

`setOwnPassword()` stays exactly as it is: it takes **no user id**, so this screen structurally
cannot be turned into a way to set somebody else's password. That constraint lives in
auth.service.js and was left there.

### Verified

- `node tools/verify-imports.cjs` → all imports resolve, nothing unreached.
- **Notifications:** four alerts render with correct severity icons, sorted
  unread-then-severity (error → warning → warning → success), the read row dimmed and last,
  announcements collapsed to a single banner, four filter pills, no horizontal overflow.
- **My account:** identity, facts, both sign-in methods read from `authMethods`, correct
  "Change password" vs "Set a password" label, theme options with the current one selected,
  14 permissions expanding from the banner, password form with two `minlength=8` fields.
- **Not verified:** `setOwnPassword()`, `markAllRead()`, `dismiss()` and `refreshAlerts()`
  against live Firestore — all four write.

## Stage 11 — Batches

### ⚠️ Never in the Claude Design project

Not lost — never drawn. Built from the v3 system.

### New

| Destination | Action |
|---|---|
| `js/modules/batches/batches.page.js` | **new** |
| `assets/css/v3.css` (appended) | seat-occupancy chips |

### Copied unmodified

**Nothing new** — `batches.service.js` arrived with Stage 7 (Timetable).

### The roster is sorted weakest-attendance-first

That ordering is `batchDetail()`'s own, not this page's, and it is the right one: reviewing a
batch, the question is who is slipping. Students with no marks sort last rather than first,
because "no data" is not "worst".

`findConflicts()` runs inside `batchDetail()`, so a double-booked room or teacher surfaces
without this page checking anything itself — which is why the detail leads with conflicts
rather than burying them.

### Create / edit / close not built

All three go through `createBatch()` / `updateBatch()` / `closeBatch()`, which carry an
`allowConflicts` override and (for closing) a `moveTo` target — closing a batch strands its
students otherwise. Those need a real form and a real confirm step; `js/ui/form.js` and
`js/ui/overlay.js` are still deliberately not copied. Buttons are present and disabled.

### Verified

- `node tools/verify-imports.cjs` → all imports resolve, nothing unreached.
- List: KPIs compute correctly (34 placed, 26 seats free, 1 unstaffed from a 3-batch fixture),
  seat chips full/open/empty, attendance chips banded 88% green / 61% red, 5 filter pills.
- Detail: conflict notice surfaces the room clash, metrics correct, roster ordered
  38% → 71% → 94% → "No marks", **inner clicks do not dismiss and the backdrop still does**
  (the Stage 8 scrim pattern, written correctly first time here).
- **Not verified:** nothing on this screen writes, so there is nothing outstanding.

) before either reached a browser.
- Tab gating measured across all three roles (table above).
- Role matrix: 4 role columns, 39 capability rows, 6 admin-only markers, 95 granted / 61
  denied cells, with `audit.purge` and `data.restore` correctly flagged admin-only.
- **Not verified:** the Preferences writes (theme/density) go to localStorage, not Firestore,
  so nothing here touches the database.

---

## ⚠️ Intentional divergences from the reference project

Files copied unmodified are byte-identical to `Natyam-ERP-UAT` **except those listed here**.
This list exists so `diff` against the reference stays a meaningful drift check: a difference
in any *other* copied file is drift, a difference in these is deliberate.

### `js/services/fees.service.js` — `collectionSummary()` now returns `overdue` / `overdueCount`

**The bug.** `dashboard.service.js` reads `collections.overdueCount` (headline KPI) and
`collections.overdue` (money panel). `collectionSummary()` never returned either, so both were
`undefined` — falsy — and the dashboard rendered a green **"nothing overdue"** while every
outstanding invoice was past due.

**Confirmed against live Firestore data, 2026-08-02:**

| Source | Count | Amount |
|---|---|---|
| `invoices$.overdue()` | 157 | — |
| `ageing` buckets (1–30d + 31–60d) | 157 | ₹2,83,500 |
| "Not yet due" bucket | 0 | ₹0 |
| **Dashboard KPI showed** | — | **"nothing overdue" (green)** |

Every rupee outstanding was overdue, reported as fine. This is exactly the failure
`dashboard.service.js`'s own header warns about — *"the dashboard read zero, forever, and
nobody noticed for months because a zero looks like an answer."*

**The fix.** One derived array and two returned fields, at the source rather than in the
dashboard, because two separate call sites read them. `overdue` is defined the same way the
ageing buckets already define it (outstanding **and** past due), so the figure agrees with
`ageing` and with `invoices$.overdue()` by construction, not coincidence.

**Verified after fixing:** `overdueCount: 157`, `overdue: 283500`, all three sources agree,
and the live dashboard now shows "157 overdue" in the negative tone.

**The reference project still carries this bug** — it was left untouched per instruction. It
is live there too, so it is worth fixing separately.

### `js/services/fees.service.js` — overpayment message no longer divides by 100

A second leftover, from the paise era. `utils/money.js` records that scaled-integer paise were
removed — *"What is typed, what is stored and what is displayed are now the same whole
number"* — but the overpayment error in `recordPayment()` still divided by 100. A ₹2,000
balance was reported as *"more than the ₹20.00 outstanding"*, which reads as though the person
had massively overpaid. Now uses `formatMoney()`, so it cannot drift from every other amount
on screen.

Found while building Fee collection, not by a test — nothing exercises that error path unless
someone actually overpays.

### `assets/css/v3.css` — light-variant tone backgrounds

The design's light variant pairs **opaque pastel** tone-fills (`#E9F5EF`, `#FBE4DC`,
`#FBEEDC`) with **white** type — `--v3-name` is `#FFFFFF` in that variant too. Measured on the
real screens, that is a contrast ratio of **1.03–1.22**, against WCAG AA's 4.5: white on
near-white, effectively invisible. The mock was evidently never checked against its own type
colour.

Replaced with translucent tints so the darkened backdrop shows through, consistent with
`--v3-card-bg` in the same variant. Delta text lightened to match, since it sits on those
tints. **Measured after: 8.10–8.98**, clearing AA and AAA.

Affected every KPI card in light theme across Dashboard, Admissions, Fee collection and
Batches — found on the fourth of those, by looking at a screenshot rather than by a test.

### `tools/dev-server.cjs` — sends `Cache-Control: no-store`

Not a reference file (new in v3), but noted because it changed for a reason worth keeping: the
browser was serving a stale ES module after an edit, which made the fix above *look* like it
had not worked — verified correct via a cache-busted import while the page kept running the
old code.

---

## Stage 8 onward

_(Settings still needs its `.dc.html` regenerated — see `docs/design/REGENERATION_BRIEF.md`.
Admissions intake wizard and the student form also outstanding.)_

---

## Stage 13 — the form layer

| Source | Destination | Action |
|---|---|---|
| _(none — no reference equivalent)_ | `js/ui/form.js` | **new file.** `formModal()` + `confirmModal()` in the v3 glass language. Field types: `text \| number \| money \| date \| select \| textarea \| switch`. Deliberately *not* a port of the reference `js/ui/form.js`, which is built on v2 components this app does not carry. |
| — | `assets/css/v3.css` | extended — `.v3-form-host`, `.v3-field-*`, `.v3-money-*`, `.v3-switch*`, plus the native-select-popup block below. |
| `js/modules/settings/settings.page.js` | same | **Add branch / Add fee plan / Add academic year wired.** `cardHead()` takes an `actionKey`; sections without one keep rendering a disabled button and an explanation, so wired and unwired look identical apart from whether they can be pressed. |

**Validation contract.** The form checks only what it can check locally and instantly — a
required field left blank, a number below a minimum, an end date before a start date. That
exists to save a round trip, not to be correct. Everything else goes to the service, and
whatever it throws is shown *in the form, against the submit button*, with the form still
open and the values still filled in. Verified: an `onSubmit` that throws leaves all three
typed values intact.

**Still unwired in Settings, and why** — editing (needs the record loaded plus a diff on save;
`updateFeePlan()` also reports how many students are affected going forward), master-set
entries (reorder/deactivate are the real operations, and `masterEntryUsage()` exists so an
entry in use cannot be quietly removed), and users (carries `requireRoleManagement()` — the
Owner may create users but may **not** mint an Administrator).

### Two bugs found and fixed during verification

**Modal mounted outside the shell — light-theme contrast failure.** `form.js` appended its
host to `<body>`. The scrim is a translucent dark wash that assumes the terracotta artwork
beneath it, which `.v3-shell` paints — on `<body>` it composited over base.css's near-white
`#F6F8FA` instead. In the light variant, which keeps **white** type, that measured **2.58–2.99**
against WCAG AA's 4.5. Every other v3 modal already renders inside the shell; the host now
mounts there too. Re-measured **7.18–16.46** across both variants. Same class of mistake as the
tone-fill fix in Stage 11, and again found by measuring rather than by a test.

**Native select popups rendered white-on-white.** The closed `<select>` is glass like every
other input, but the open popup is drawn by the OS: it cannot inherit `backdrop-filter`, and
on Windows/Chrome it paints on its own white sheet. Our inputs set `color: var(--v3-name)` —
white in both variants — so only the highlighted row was readable. Options now get an explicit
opaque surface (`#2A1710`) plus `color-scheme: dark` for the sheet itself. Applied to
`.v3-input` and `.v3-branch-select`; the same fix is in `natyam-mobile` for `.v3-input` and
`.m-sheet-branch`. This is one of the few places the glass language has to be abandoned
rather than adapted, because the element being styled is not ours to composite.

**Not verified:** no `create*` call has been submitted against live Firestore — doing so would
write a real branch/plan/year into the production project. The form was exercised end to end
with a throwing `onSubmit` instead.

---

## Stage 14 — Batches and Students write paths

The two buttons flagged as dead in testing ("New batch", "Add student") are now live, along
with Edit and Close batch.

| Source | Destination | Action |
|---|---|---|
| `js/services/staff.service.js` | same | **partial copy — `availableTeachers()` only.** The Staff module is Phase 2 (`/staff` is still `load: null`), so hire/updateStaff/deactivate/reactivate/listStaff/teacherDashboard/payrollTrend/staffSummary have no caller here and would drag in `salaries$`, `programs$` and `attendance$` for code nothing runs. The rest arrives when `/staff` does. |
| `js/modules/batches/batches.page.js` | same | New batch, Edit, Close batch wired |
| `js/modules/students/students.page.js` | same | Add student, Edit wired |
| — | `js/ui/form.js` | extended: `checks`, `divider`, `tel`/`email`; live error retraction |

### Form layer additions

- **`checks`** — multi-select tick-boxes rendered as chips, for a batch's levels and days.
  Its value is an **array in declared option order**, not tick order: `createBatch` treats
  `days` as a set but renders it as a sequence, and a register reading "Wed, Mon" is a small
  daily papercut. Required-empty is a real case here — an empty array is not `''`, so the
  scalar emptiness test would have waved a required multi-select straight through.
- **`divider`** — a labelled rule. The student form runs to seventeen fields and is a wall
  without them. Presentational, so it is skipped by both the value reader and the validator;
  without those two guards it would have written `undefined` keys into every submitted record.
- **`time`, `tel`, `email`** — already worked through the generic input path; now documented
  and used.
- **Errors now retract as you type**, but only the ones that can be judged locally: "X is
  required" disappears the moment X has a value. Done by touching the two affected nodes
  directly rather than re-rendering — a repaint per keystroke would rebuild the inputs and
  drop focus and caret mid-word. Anything the *service* rejected stands until the next
  submit, because only the service can say whether it is fixed.

### The batch conflict override

`createBatch`/`updateBatch` throw with `err.conflicts` attached when a batch clashes with a
teacher's or a room's existing booking. The page shows exactly what it collides with and asks
— a school does sometimes mean it. Declining re-throws, which leaves the form open with
everything still typed and the clash shown against the submit button; the fix is to change a
day, time, teacher or room, and all of those are still on screen.

The teacher picker is fed by `availableTeachers()` rather than a plain staff list, so a
fully-booked teacher is labelled as busy *before* the conflict check rejects the save.

**Not included:** the reference student form's `curriculumId` field. Curriculum there means a
course of study owned by the Programmes module, which is Phase 2, so this app has no
`listCurricula()` to populate it. `enrol()` accepts a record without one and it is assignable
later.

### Verified

Against live Firestore, signed in as Administrator: the student form loads 2 real branches,
13 curriculum levels, 5 batches with live enrolment counts (23/30, 38/50, …) and 4 fee plans
with real amounts; the batch form loads the same branches, all 13 levels and the real teacher
with their true load ("Sai Surekha A — 5 batches"). Local validation blocks an empty submit on
both. All 11 routes render with no console errors.

**Not verified:** no create was actually submitted — `enrol()` and `createBatch()` would write
a real student and a real batch into the production project. The `checks` round-trip
(declared-order arrays, empty-array required, cross-field time validation, `null` for a blank
number) was exercised end to end against a stub `onSubmit` instead.

---

## Stage 15 — the rest of Settings

Every button on the Settings screen is now live: **Edit the school**, **Add entry** (all three
master sets) and **Add user**, joining the three creates from Stage 13. `_stillDisabled` on
that screen is now 0.

### Form layer additions

- **`showIf: (values) => boolean`** — conditional fields. The user form needs it: Email is
  only relevant to Google and Email-&-password, the initial password only to Email-&-password,
  the mobile number only to Mobile OTP. A hidden field is **skipped by the validator too** —
  otherwise "Set an initial password", hidden because the chosen method has nothing to do with
  passwords, would make the form unsubmittable with no visible field to fix. Applied by
  toggling `hidden` on the wrapper rather than re-rendering, so a tick mid-group doesn't cost
  focus; re-applied inside `paint()` because every repaint rebuilds the fields.
- **`validateAll: (values) => ({field: message}|null)`** — a form-level pass for rules that
  belong to no single field. Runs after the per-field pass and never overwrites it, because a
  blank required field is the more useful thing to say first.

### The user form and the guardrail

`requireRoleAssignable()` refuses to let anyone without `role.manage` create an Administrator.
The form does **not** reimplement that — it declines to *offer* the choice, so an Owner never
picks Administrator and then gets refused. The service still decides; `firestore.rules`
decides again server-side. Verified the role list is built from `roleMatrix()` filtered on
`session.can(ROLE_MANAGE)`.

### 🔴 A gap found by walking into it — and a write I had to undo

Testing the duplicate check on curriculum entries, I typed `foundation level 1` expecting it
to be refused. **It was accepted and written to the live Firestore.**

`addMasterEntry()` compares only the derived *value*. `foundation level 1` slugs to
`foundation-level-1`, which does not collide with the shipped `foundation-1` — so a second
entry labelled almost identically to "Foundation Level 1" went onto the list, and the level
dropdown would then have offered two of them.

The junk entry (`foundation-level-1 :: foundation level 1`, order 14) was removed with
`deleteMasterEntry()` after confirming `masterEntryUsage()` returned 0 — nothing referenced
it. The set is back to its original 13 entries, verified by listing them.

Guarded in this page's `validateAll` with a case-insensitive **label** clash check, on top of
the service's value check. Verified: `foundation level 1`, `FOUNDATION LEVEL 1` and
`Foundation Level 1` are all now refused locally, and the entry count stays at 13.

**The service-side gap is still open, and it is inherited from the reference project** —
`js/services/settings.service.js` there has the same value-only check. A UI guard is
bypassable by any other caller. Fixing it at source means diverging this app's copy from the
reference, which is the user's call (the same call they made for the `overdueCount` bug in
Stage 3). Flagged, not fixed unilaterally.

### Verified

All 18 routes and Settings tabs render, no console errors, no disabled buttons left on
Settings. Edit-the-school opens pre-filled with the real institute record. The conditional
fields on the user form were exercised through every combination of sign-in methods, in both
directions, and hidden required fields confirmed not to block submission.

**Not verified:** no user, branch, plan, year or school edit was actually submitted — each
would write to the production project. The one write that did happen was the accident above,
and it has been reverted.

---

## Stage 16 — Admissions intake

`New application` is live. Approve / Reject / Begin review / Reopen / Enrol were already
wired in Stage 5; intake was the one gap.

### One grouped form, not a wizard — a deliberate change from the reference

`ADMISSION_STEPS` is a **validation** structure, and it stays exactly that: every step is
still checked, by the service's own `validateStep()`, through the form's `validateAll` hook.
What the reference additionally made it was a **navigation** structure — five screens to click
through for a walk-in standing at the desk, where the whole application is fourteen fields.

On a desktop screen those fourteen fit at once under the step names as headings, so the person
taking the application can see and correct the whole thing rather than discovering on screen
four that they mistyped something on screen one. The steps survive as dividers, in their own
order, so the shape stays recognisable to anyone who knows the paper form.

**Validation is delegated, not restated.** `validateAll` loops `ADMISSION_STEPS` and merges
`validateStep(step.key, values).errors`, which is already a field-keyed map — exactly the shape
the hook wants. The page therefore contains no copy of the rules that the school takes students
from age 4, that a contact number needs ten digits, or that a date of birth cannot be in the
future. Verified all four surface against the right field.

**Not carried over: drafts.** `saveDraft` / `loadDraft` / `listDrafts` / `discardDraft` exist
in the service and are not surfaced. A draft earns its keep when a form is long enough to
abandon halfway, which is precisely what collapsing the wizard removes. `submit()` still
accepts a `draftId`, so nothing is closed off if drafts come back.

### Verified

Form opens with 4 dividers and 14 fields, real fee plans with real amounts, sensible defaults
(relationship "Mother", previous training "None", branch left empty because this school has
two). An empty submit marks all eight required fields at once rather than stopping at the
first. The age, phone, email and future-date rules each land on their own field. All 11 routes
render, no console errors.

**Not verified:** nothing was submitted — `submit()` would create a real application, allocate
a real `NAT/APP` sequence number and fire a notification.

---

## Remaining not-yet-built actions (whole admin app)

Only three disabled buttons are left, all outside this stage's scope:

| Where | Button | Why it is still disabled |
|---|---|---|
| Attendance | Postpone session | Needs a replacement date *and* a reason, and a rule for what happens to a register already marked on the original date |
| Attendance | Cancel session | Needs a reason, and the same question about marked registers |
| Students profile | The `OPERATIONS` row (promote, set status, archive, delete, assign batch) | Each is a distinct service call with its own consequence — `deletionImpact()` exists precisely so a delete can say what it will take with it |

Phase-2 routes still `load: null`: Parents, Staff, Programmes, Certificates, Finance,
Analytics, Reports.

---

## Stage 19 — the last of the Phase-1 write paths

Attendance's Postpone and Cancel class, and the student profile's operations row.

| File | Action |
|---|---|
| `js/modules/attendance/attendance.page.js` | Postpone, Cancel class wired; Class calendar now links to Timetable |
| `js/modules/students/students.page.js` | Move batch, Promote, Status wired |

### The open question about postponed registers answered itself

I had flagged this as needing a decision: *if a session is postponed or cancelled after
attendance was already marked, what happens to those marks?* Reading the service, the question
was misframed — **neither function touches the attendance collection at all.**

`postponeSession()` "never deletes the original — only marks it Postponed, and stays linked to
whatever replaces it forever" (its own words), and `cancelSession()` marks the session
cancelled in place. Attendance rows are keyed by batch and date in their own collection and are
untouched by both. Marks stay against the date they were taken on, which is the only answer
that cannot lose a record of who actually turned up.

So there was nothing to decide — only something to *say*. The register screen now states it
under the two buttons, and the Cancel dialog names the number of students already marked and
confirms their marks are kept.

### Notes on the three student operations

- **Move batch** — an empty selection is a real choice, not a missing one (`assignToBatch()`
  treats a null batch as "take them off every batch"), so the field is deliberately not
  required and the placeholder says what it does.
- **Promote** — the ladder is checked *before* the dialog opens. `promote()` throws both for an
  unrecognised level and for the final level; catching those first means the person gets an
  answer instead of a pointless form followed by a rejection. The dialog also says that
  promoting clears the batch, because otherwise the student quietly vanishes off a register
  the next morning.
- **Status** — the first form to use `showIf` and `validateAll` together: the reason field
  appears only for Inactive and Graduated, and is required only then. `setStatus()` returns any
  outstanding balance rather than cancelling it, so that figure is surfaced in a second toast
  instead of being swallowed.

### Cancel class uses a nested confirm

`formModal`'s `onSubmit` awaits a `confirmModal`. Declining throws, which is what keeps the
form open with everything still typed and the message against the submit button. Verified both
hosts mount with the confirm on top, that declining leaves the service uncalled, and that
confirming calls it exactly once.

### Verified

The new form-layer combinations were exercised end to end against stubs: `showIf` + `validateAll`
(including the case where switching back to a non-leaving status both hides the field *and*
stops it blocking submission), and the nested-confirm pattern. Every page module and every
service the new code reaches imports cleanly. `verify-imports` passes in both apps; CSS braces
balance; the reference project is untouched.

**Not verified this round, and worth stating plainly:** both apps' Firebase sessions expired
partway through and could not be re-established from here, so none of these three screens was
exercised as a signed-in user against live data. The wiring is proven by static resolution and
by isolated tests of the new logic, *not* by clicking the real buttons. The first thing worth
doing on the next signed-in run is opening a register and a student profile.

---

## Phase 1 is now complete on the desktop app

Every button on every migrated screen is live. The only two disabled controls left are the
student profile's **Collect fee** and **Issue certificate**, and both are correct: they belong
to the Fees payment dialog and the Certificates module, which are Phase 2. They stay visible
and disabled with an explanation rather than being dropped, because the row's shape comes from
an approved design.

Still `load: null`, all Phase 2: Parents, Staff, Programmes, Certificates, Finance, Analytics,
Reports.

---

## Stage 19 verification — completed on the next signed-in run

The three screens Stage 19 left unverified were exercised against live data as Administrator.
Nothing was submitted; every dialog was cancelled.

| Screen | Result |
|---|---|
| Student → Move batch | Opens on the real student; batch list from the live roster |
| Student → Promote | Reads the real ladder position — "Foundation Level 1 → Foundation Level 2" — and states that promoting clears the batch |
| Student → Status | "Currently Active"; the reason field is correctly **hidden** until a leaving status is picked |
| Student ops row | Move batch / Promote / Status live; Collect fee and Issue certificate disabled with their Phase-2 explanations |
| Attendance → Postpone | Real batch and date; start/end **pre-filled from the batch's own schedule** (17:00–18:30); real teacher in the picker; blocks on missing date and reason |
| Attendance → Cancel class | Blocks on missing reason; the "N already marked" divider correctly absent when nobody is marked yet |

The register screen's standing note renders as intended: *"Postponing keeps this class on record
and links it to its replacement. Neither postponing nor cancelling touches attendance already
marked."*

---

## Stage 20 — Parents (Phase 2)

First of the seven deferred routes, and the cheapest: **no new services or repositories.**
`households()`, `householdSummary()` and `updateStudent()` were already migrated inside
`students.service.js`, so the closure was empty.

| Source | Destination | Action |
|---|---|---|
| `js/modules/students/parents.page.js` | same | **redesigned** — same behaviour, v3 shapes |
| `js/config/navigation.js` | same | `/parents` `load: null` → real import |

### No design file, so it borrows one

`Parents.dc.html` was never generated — the design project was deleted before Phase 2. Rather
than invent a layout, this reuses the Students screen's established v3 shapes: KPI strip,
filter bar with pills, `v3-roll` card list, centred detail modal. Consistent by construction
with a screen that *does* have an approved design, which is the safer way to be wrong.

### What changed from the reference, and why

- **DataTable → card list.** `components.css` and `ui/table.js` are not carried by this app
  (the v3 design replaced tables with card lists everywhere); the reference's four sortable
  columns become one row per household with the same four facts on it.
- **Two more filters.** The reference offered siblings / owing / no-email. "No phone" is added
  because unreachable families are the reason this screen exists, and a KPI alone does not let
  you *list* them.
- **The fan-out write reports partial progress.** The reference's `editContacts` loops
  `updateStudent` over every child and lets a mid-loop failure reject the whole thing with no
  indication of how far it got. Here the loop counts, and a failure throws
  *"2 of 4 records updated, then Sara Iyer failed: …"* — because after a partial write the
  number that already changed is the thing you need to know. Sequential rather than
  `Promise.all` for the same reason.

### Verified against live data

129 households derived from 157 students; 21 with siblings; 0 unreachable; ₹2,85,000 owed
across 129 households. Filters return counts matching the subtitle exactly (siblings 21,
no-phone 0, no-email 1, all 129). Search on "Iyer" narrows correctly. The detail panel shows
the guardian's real contacts and all four Iyer children with their levels, batches and
balances; clicking inside does not dismiss it, the backdrop does. All 12 admin routes render
with no console errors.

**Not verified:** no contact edit was submitted — it would write to four real student records.

---

## Phase 2 remaining

Staff, Programmes, Certificates, Finance, Analytics, Reports — all still `load: null`. Staff is
next-cheapest: `js/services/staff.service.js` already exists here as a partial copy
(`availableTeachers` only, added in Stage 14), so completing it is a known, bounded piece of
work rather than a fresh closure.

---

## Stage 22 — Staff, on both surfaces

First module built to the corrected policy: desktop and mobile in the same stage.

| Source | Destination | Action |
|---|---|---|
| `js/services/staff.service.js` | natyam-admin, same | **partial copy completed** — the other eight functions, now that they have callers |
| `js/services/staff.service.js` | natyam-mobile, same | **copied whole** (see below) |
| `js/modules/staff/staff.page.js` | natyam-admin | **new** — full management |
| `js/modules/mobile/staff.page.js` | natyam-mobile | **new** — read and reach |
| both `navigation.js` | — | `/staff` wired |

### Completing the partial service cost nothing extra

Stage 14 copied only `availableTeachers()` for the batch form's teacher picker. Every
repository the rest needs — `salaries$`, `programs$`, `attendance$` — was already exported in
both apps, and `teacherSchedule` and `listBranches` were already migrated. So the closure was
already satisfied; this was a copy, not an expansion.

**Mobile takes the file whole rather than trimmed**, which is a departure from the
copy-only-what-you-need rule and a deliberate one: the mobile page calls three of nine
functions, but `teacherDashboard()` alone pulls the entire import closure. Trimming would
delete code without dropping one dependency, and would leave the two apps holding
differently-shaped copies of one service.

### The split between the surfaces

**Desktop — full management.** Add, edit, end employment, bring back.

**Mobile — read and reach.** Who is teaching, how loaded they are, and their number, with
`tel:`/`sms:` handoff. No write path at all, and the sheet says why: `deactivate()` can hand a
departing teacher's batches to someone else in the same call, and choosing who inherits a
class is not a decision to make on a 375px screen between sessions. A deliberate split, stated
rather than left as an unexplained absence.

### The guardrail, exercised for real

`deactivate()` refuses while someone still holds batches, throwing with `err.batches`
attached. The page catches that and re-throws with the batches **named**, rather than passing
on the count alone. Verified live against the real record — submitting with a reason and no
replacement produced:

> *"Sai Surekha A teaches 5 batches. Choose who takes them over. They currently teach:
> Hafeezpet Junior Batch, Hafeezpet Senior Batch, Kondapur Adult Batch, Kondapur Junior Batch,
> Kondapur Senior Batch."*

Nothing was written; the form stayed open with the reason still typed.

**A gap that exposed:** the school currently has exactly one teacher, so the "hand their
batches to" dropdown is empty — and its placeholder read *"Nobody — they teach none"*, which
describes the wrong situation. It now reads *"No other teacher on the books"* with help text
saying that anyone still running a batch cannot be taken off staff until another teacher
exists. The rule is the service's; this only stops the form implying a choice that isn't there.

### Verified live

**Desktop:** 1 on staff, ₹35,000 wage bill, payroll "Not run". Detail opens the real teacher
dashboard — phone, email, both branches, joined 1 Jun 2023, and all five batches with live
attendance rates (99%, 86%, 85%, 94%, 91%). Edit pre-fills with both branch chips ticked.

**Mobile:** "1 of 1 on staff · 1 teaching · ₹35K a month"; metrics 5 batches / 158 students /
11 per week; `tel:+91…` correct; same five batches; no write controls present. Staff appears
in the More sheet between Parents and Batches.

No console errors on either. Nothing submitted.

**One of my test failures was mine, not the code's:** an early detail check reported "did not
open" because the tab had drifted to Admissions and I passed an admission id into
`teacherDashboard()`. Re-run on the Staff page it opens correctly.

---

## Stage 23 — Programmes, on both surfaces

| Source | Destination | Action |
|---|---|---|
| `js/services/finance.service.js` | both apps | **copied** — ahead of the Finance *module*, because Programmes needs it |
| `js/services/programs.service.js` | both apps | copied verbatim |
| `js/modules/programs/programs.page.js` | natyam-admin | **new** — full lifecycle |
| `js/modules/mobile/programs.page.js` | natyam-mobile | **new** — cast list on the day |
| both `navigation.js` | — | `/programs` wired |
| both `js/ui/form.js` | — | `checks` fields gain a filter (see below) |

### Finance's service arrived early, for a reason

`complete()` posts a programme's income and expenditure to the ledger through
`finance.postEntry()`. A programme that quietly failed to do that would leave the books wrong
in a way nobody notices until the month closes. So the service comes now — the dependency
arriving when it is genuinely required, not speculatively. The Finance *screens* follow in
their own stage. Every repository it needs (`ledger$`, `expenses$`, `LedgerMath`,
`postPayroll`…) was already exported in both apps, so the closure was already satisfied.

### The split between surfaces

**Desktop — the full lifecycle:** schedule, edit, cast, complete, cancel.

**Mobile — the cast list, on the day.** Defaults to *Upcoming*, sorted soonest-first. Casting
**is** available here, unlike Staff's writes, and deliberately: a student drops out on the
morning of a performance and the list has to change before the curtain. Scheduling, editing,
completing and cancelling stay on desktop — completing posts to the ledger, which belongs
where the figures can be checked.

### 🔴 A 158-checkbox list with no way to find anyone

`eligibleStudents()` returns the whole active roster for the branch. For the school-wide
Annual Day that is **158 students**, rendered as 158 chips in a dialog with no search — and
the group was tall enough to push the submit button out of reach.

`checks` fields now get a filter automatically past 24 options (`searchable` overrides),
a capped 210px scroll area, and a live "8 of 158 selected · 6 shown" count.

**The filter hides chips; it never unticks one.** That is the whole design constraint:
`setParticipants()` replaces a cast wholesale, so if searching could drop somebody from the
selection, filtering to check one name would silently remove everyone else on submit.
Verified explicitly — filtering to a term matching *nothing* leaves all 8 still ticked, and
clearing the filter brings all 158 back with the 8 intact.

### Verified live, both surfaces

**Desktop (Administrator):** 2 programmes — Annual Day — Rangapravesham (13 Sep, 8 cast,
41 days away) and Kuchipudi Basics Workshop (10 Aug). KPIs read "Next: Kuchipudi Basics
Workshop on Monday, 10 Aug 2026", "Performance 1 · Workshop 1", 8 students involved. Cast by
level shows Foundation 1 × 4 and Foundation 2 × 4. The schedule form's **level field appears
only for Examination** and hides again for every other type. Complete dialog states that money
posts to the ledger and carries two ₹ fields.

**Mobile (Owner & Accountant):** defaults to Upcoming, soonest-first; cast picker offers
**112** eligible for the Kondapur workshop against 158 for the school-wide Annual Day — the
service's branch scoping, visible and correct.

All 13 admin routes and all 13 mobile routes render with no console errors.

**Not verified:** nothing was submitted. `schedule()`, `setParticipants()` and especially
`complete()` all write, and `complete()` would post real ledger entries.

**A correct-looking oddity, checked rather than assumed:** the Annual Day's Branch reads "—".
That is real — the record has `branchId: null` because it is a school-wide event, not a
resolution failure.

---

## Stage 24 — Certificates, on both surfaces

| Source | Destination | Action |
|---|---|---|
| `js/services/certificates.service.js` | both apps | copied verbatim; closure already satisfied |
| `js/modules/certificates/certificates.page.js` | natyam-admin | **new** — register, issue, revoke, verify |
| `js/modules/mobile/certificates.page.js` | natyam-mobile | **new** — verify and read |
| both `navigation.js` | — | `/certificates` wired |

### Three service rules honoured, not reimplemented

- **Eligibility is asked, never guessed.** `checkEligibility()` returns an array of reasons,
  so the dialog shows every refusal at once instead of revealing them one rejected submit at a
  time.
- **The override is offered only after a refusal.** A `force` switch sitting on the form from
  the start would make waiving the rules the easiest path through it — the opposite of what a
  certificate needs. So the flow is: submit → service objects → confirm you mean it → give a
  reason → issue. The reason is stored on the certificate, not just in a log.
- **Nothing is deleted, only revoked**, and a revoked serial still *verifies*. There is no
  delete on this screen, and the revoke dialog says the serial stays checkable.

### The wording is read off the record, never regenerated

`issue()` renders `title`, `body` and `signatories` once and stores them. Both detail views
print those stored strings rather than re-running the template. A certificate shown in 2037
must say exactly what it said the day it was issued, even if the template, the curriculum or
the school's name has changed since — re-rendering would quietly rewrite history.

### Verify is the mobile case, and it leads the screen

Somebody rings holding a piece of paper and asks whether it is real. That call is answered
wherever the person picking up is standing, so **Verify is the first control on the mobile
screen**, above the register — not behind a menu. It needs no capability, deliberately: an
office junior taking that call should be able to answer it.

The answer is **thrown rather than resolved**, so it stays on screen next to the serial that
was typed instead of flashing past in a toast while it is read down a telephone. `verify()`
already writes the sentence, so it is shown as written rather than reassembled.

Issuing and revoking stay on desktop; the mobile sheet says why.

### Corrections made against the real service contract

Three shapes I had assumed were wrong, and were checked before wiring rather than after:
`printData()` returns `{certificate, student, institute, signatory, verifyHint}` — not `body`
or `signatories` at the top level; `verify()` returns `{found, valid, certificate, message}`
with the sentence already written; and list rows carry `templateName`/`levelLabel`, not a
`title` derived at read time.

### Verified live, both surfaces

1 certificate on file: **NAT/CRT/26/0025**, Performance diploma for Abhinav Iyer, issued on
override ("Test"). Both surfaces verify it and surface the override in the answer. An
impossible serial returns *"No certificate has ever been issued with the serial …"*. The typed
serial survives the repaint after a failed verify.

The issue dialog gates its fields per template exactly as `TEMPLATES.requires` declares:
Programme shows only for Participation, Citation only for Merit, neither for Level completion
or Diploma. Programme options correctly read "No completed programme yet" — both programmes
are still scheduled.

**Not verified:** nothing was issued or revoked. Issuing mints a permanent serial.

---

## Phase 2 remaining: Finance, Analytics, Reports

Three routes left, all `load: null`, and all three are the data-dense ones. `finance.service.js`
is already migrated (Stage 23, for Programmes), so Finance's closure is partly satisfied
already.

---

## Stage 25 — Finance (desktop)

Four tabs, because Finance is four jobs: **This month** (P&L + six-month trend),
**Spending** (breakdown *and* the individual rows), **Ledger**, **Payroll**.
`finance.service.js` was already migrated in Stage 23.

### 🔴 The P&L does not reconcile with its own ledger

Found on the real July 2026 data, and it is material: the summary reports a **+₹13,795 profit**
while the ledger for the same range reports a **−₹28,205 loss**. ₹42,000 apart.

The cause is `profitAndLoss()`'s filter, inherited from the reference project:

```js
.filter((e) => !e.reversedBy || e.sourceType === 'reversal')
```

A reversal produces two rows: the original, and a contra of the **opposite type**
(`reverseEntry()` gets that right — the contra for a ₹42,000 expense is a ₹42,000 income).
The filter drops the original but **keeps the contra**. So reversing a salary leaves ₹42,000
sitting in the *income* column — July's P&L genuinely lists "Salaries" as an income account of
₹42,000 — while the real expense is gone. Both sides should be dropped; they exist to cancel,
not to be counted once each on opposite sides.

Checked against the underlying numbers: real income is ₹1,13,500 (tuition only), real spending
₹1,41,705, so the true net is **−₹28,205** — which is what the ledger says. The ledger is
right; the P&L is wrong.

**Not fixed here.** An accounting rule is not a UI decision, and the same bug is in the
reference project — this is the same class of call as the `overdueCount` bug in Stage 3. The
one-line fix would be `.filter((e) => !e.reversedBy && e.sourceType !== 'reversal')`, in both
v3 apps or in the reference too. **Awaiting a decision.**

**What the screen does meanwhile:** `reconciliation()` compares the P&L net against the ledger
net for the same range and, when they disagree, prints a red notice naming both figures, the
gap, the cause, and *"Trust the Ledger tab until this is settled."* Verified live — the notice
renders on July with exactly those numbers. Nobody reads a profit off a screen whose own
ledger says loss.

### Two service behaviours the page had to be built around

**`preparePayroll()` is a WRITE despite its name** — it calls `salaries$.create()` for every
active staff member without a line for the period. Calling it on tab-open would mean *looking*
at Payroll silently created records, and it needs `finance.edit`, so a view-only user could not
have opened the tab at all. The tab therefore opens empty, explains itself, and preparing is an
explicit button. `alreadyPrepared` then distinguishes "already run" from "just created".

**The ledger is append-only.** `reverseEntry()` writes a contra; it never edits or deletes. So
there is no edit control on a ledger row, and the reversal dialog says a correcting entry will
appear rather than implying the mistake disappears.

### Contract mismatches caught before wiring

- `preparePayroll()` returns `{period, lines, gross, net, alreadyPrepared}` — **`lines`**, not
  `rows` or `salaries`.
- `EVENTS.SALARY_PAID` does not exist; it is `SALARY_PROCESSED`.
- `recordExpense()` **requires** a branch, unlike a manual ledger entry which may be
  school-wide.
- The expense form must offer `expenseCategories()`, **not** `ACCOUNTS.expense` — the two
  differ by "Salaries", which `ACCOUNTS.expense` prepends for payroll's ledger account but
  `recordExpense()` rejects. Salaries are paid through payroll, not typed in as an ad-hoc
  expense.

### Verified live (Administrator)

August (current, empty): all four tabs render, ₹0 throughout, six months charted, Payroll
correctly shows the prepare button and **no lines written**. July: income ₹1,55,500, spending
₹1,41,705, 75 entries, 2 income accounts and 7 expense accounts; Ledger shows 76 rows with
running balances and a Reverse control on each. No console errors.

**Not verified:** nothing was posted, recorded, reversed, prepared or paid.

**Still to do for this stage:** the mobile Finance view (summary + drill-down).

### ✅ The P&L reconciliation bug — FIXED (approved: both v3 apps only)

`profitAndLoss()` and `monthlySeries()` in **both** v3 apps now exclude both sides of a
reversal:

```js
.filter((e) => !e.reversedBy && e.sourceType !== 'reversal')
```

`ledgerView()` is deliberately left unfiltered — the ledger is the audit trail and must keep
showing the original entry and its contra.

**Before → after, on the real July 2026 data:**

| | before | after |
|---|---|---|
| Income accounts | Tuition ₹1,13,500 **+ "Salaries" ₹42,000** | Tuition ₹1,13,500 |
| Total income | ₹1,55,500 | **₹1,13,500** |
| Total expense | ₹1,41,705 | ₹1,41,705 |
| **Net** | **+₹13,795 (profit)** | **−₹28,205 (loss)** |
| Ledger net | −₹28,205 | −₹28,205 |
| Reconciles? | ❌ ₹42,000 apart | ✅ exactly |

The phantom "Salaries" income account is gone. The six-month trend now reports July as
income ₹1,13,500 / expense ₹1,41,705 / net −₹28,205, agreeing with the P&L above it instead of
contradicting it. The Ledger tab is untouched: still 76 rows, still showing all three Sai
Surekha entries (original, contra, real payroll), still totalling ₹1,55,500 / ₹1,83,705.

The `reconciliation()` guard on the Position tab stays in place. It now finds nothing and
renders nothing — which is the point: it is a standing check that the summary and the ledger
agree, not a one-off notice. If they ever diverge again it will say so on screen.

**The reference project still carries the bug.** Both v3 services carry a ⚠ header block
recording the divergence and why, so a future sync does not silently undo it.

---

## Stage 26 — Data tab: Option B (decided)

**The open question carried since Stage 0 is closed.** Option B: drop IndexedDB
compatibility, support only Firestore-era backups.

| Source | Destination | Action |
|---|---|---|
| `js/services/backup.service.js` | natyam-admin | **rewritten** — Firestore-only, 536 → ~390 lines |
| `js/data/curriculumLevels.repository.firestore.js` | both apps | copied — *for backup completeness only* |
| both `js/core/bus.js` | — | `BACKUP_CREATED` added (see below) |
| `js/modules/settings/settings.page.js` | — | Data tab replaces the decision placeholder |

### Why a rewrite and not a copy

The reference service carries `db` from `core/db.js` in four places: the envelope
(`db.exportAll()`), a `db.importAll()` branch in restore, a `db.all()` fallback in the
single-store export, and a `db.clear()` loop in the erase. **v3 has no `core/db.js` at all** —
no device running it has ever held data locally. Copying it would have meant maintaining a
code path that could not run.

What was kept, because the reference learned it the hard way: the envelope (app + schema
version, when, by whom); *a restore that recognises nothing must not proceed*; accounts
included in the file but opt-in on restore; and **erase by exclusion from one list**, not an
allow-list that goes stale the moment a collection moves.

### 🔴 A collection would have been silently missing from every backup

`curriculumLevels` is a real Firestore collection, but its repository was trimmed out of v3 at
Stage 0 as unused. Unused by a *screen* is not unused by a *backup*: a file omitting it would
restore cleanly and quietly leave that data behind. The repository is now carried in both apps
purely so backups are complete, and says so in its export comment.

### 🔴 `EVENTS.BACKUP_CREATED` never existed

The reference emits it; its bus never declares it. So that emit fires on `undefined` and no
listener can ever receive it — and `verify-imports` cannot catch it, because it is a property
read on an object that does exist. Declared properly in both v3 buses.

Also corrected against the real contract: `users$.restoreAll()` resolves to
`{ written, skipped }`, not a count — `skipped` is now surfaced, because it is how somebody
learns their own account was deliberately left alone rather than wondering why the numbers
do not add up.

### The three controls are deliberately unequal

Taking a backup is a plain action. **Restore sits behind a file picker** and offers no button
until a file has been read and described — the decision is made against the file's contents,
not its name. **Erase is last**, and both it and restore confirm against a **typed phrase**,
because one click should not be able to replace or delete every record and "are you sure?"
stopped being read years ago.

### Verified live (Administrator) — read paths and every guard

Panel reads the real project: **3,096 records across 20 collections with data**, largest
`auditLog` 1,541. A backup built in memory (not downloaded) carries all **25** sections
including `curriculumLevels` and 3 user accounts, stamped `storage: 'firestore'`,
app 3.0.0, schema 6.

Guards, all confirmed with the record count checked before and after — **3,096 → 3,096,
nothing touched**:

| Attempt | Result |
|---|---|
| Inspect a real v3 backup | accepted, 25/25 recognised, not flagged legacy |
| Inspect a pre-v3 file | flagged legacy, 1 recognised / 6 unknown |
| **Restore a pre-v3 file** | refused: *"Only 1 of 7 sections … restoring it would replace some collections while silently leaving others behind. Nothing was changed."* |
| **Restore an unrecognisable file** | refused: *"contains no data this version recognises…"* |
| Inspect a foreign file | refused: *"That is not a NATYAM ERP backup file."* |
| Erase, empty confirmation | blocked |
| Erase, wrong phrase | blocked: *"Type ERASE exactly. This cannot be undone from here."* |
| Restore button before a file is chosen | absent |

**Not verified, and deliberately not:** no backup was downloaded to disk, and neither
`restore()` nor `resetEverything()` was run to completion. Both would rewrite or delete every
record in the live project. The refusal paths are proven; the success paths are not, and
should be exercised first against a throwaway Firebase project rather than this one.

---

## Stage 27 — Analytics and Reports (desktop)

The last two `load: null` routes. **`load: null` count in navigation.js is now 0.**

| Source | Destination | Action |
|---|---|---|
| `js/services/analytics.service.js` | both apps | copied; closure already satisfied |
| `js/services/reports.service.js` | both apps | copied, then **one column fix** (below) |
| `js/modules/reports/analytics.page.js` | natyam-admin | **new** |
| `js/modules/reports/reports.page.js` | natyam-admin | **new** |

### Analytics: naming the panels that failed

`analyticsOverview()` gathers ten panels with `Promise.allSettled` and returns a `failed` array.
That is the right call — one broken query should not blank the screen — but it only pays off if
the page **says which panels are missing**. A dashboard that silently renders nine of ten is
worse than one that fails loudly, because the reader has no way to know the picture is
incomplete. The notice names them.

No chart library: `ui/chart.js` belongs to v2's stylesheet, which this app never loads. Trends
are the same `.v3-trend` bars Finance uses.

### Reports: the filter bar is built from each report's own declaration

Every catalogue entry names which of branch / batch / level / status it honours. Showing a
level filter on Payroll would be a control that silently does nothing, because the builder
never reads it — worse than no control. Verified per report: Payroll offers branch only,
Outstanding fees adds batch, Staff roster adds status, Student roll offers all four.

**This is the one screen in v3 that legitimately renders a table.** Everywhere else the design
replaced tables with card lists, rightly. But a report is a grid by definition — printed,
exported to a spreadsheet, handed to an accountant, with columns declared by the service.
Cards would make it unexportable and unreadable at once. It scrolls inside its own container;
the page never scrolls sideways (measured both).

### 🔴 A report column that could never populate

Swept all 14 reports for columns whose key exists on no row. `fee-outstanding` declared
**`invoiceNo`** and **`paid`**; the invoice documents carry **`number`** ("NAT/INV/26/0033")
and **`paidAmount`**. So the Outstanding-fees report rendered an empty Invoice column and an
empty Paid column on **every one of 158 rows** — an outstanding-fees report you cannot use to
identify an invoice.

Fixed in both v3 apps; the reference still carries it. Re-swept afterwards: all 14 reports
clean.

**One apparent match that was *not* a bug**, checked rather than assumed: `staff-roster`'s
`employeeNo` is also always empty — but the staff document genuinely has no `employeeNo` field
set for the school's one teacher. Empty data, not a wrong key. Left alone.

### A cost worth knowing about

`Settings → Data` takes **~4.1 seconds** to open, because `backupStatus()` reads every
collection — 3,114 documents — to display three numbers. It is cached per visit, so it is once
per navigation rather than once per repaint. On a project that has already hit its free-tier
read quota once, that is a real cost and is recorded here rather than left to be discovered
from a bill.

### Verified live (Administrator)

**Analytics:** all ten panels built (no failure notice), 7 KPIs with direction and delta —
158 students, 92% attendance, ₹2,85,000 outstanding — 4 trend cards × 12 months, Branches,
Teachers and the admissions funnel. "Net this month ↑ ₹28,205" reflects the corrected P&L
from Stage 25.

**Reports:** 14 reports across 9 groups. Student roll returns all 158 with real admission
numbers, levels, batches and guardians. Outstanding fees returns 158 rows with the service's
own note *"158 of 158 invoices are past their due date"*, totals in the footer, and invoice
numbers now present. CSV / Spreadsheet / Print appear only once a report has been run.

**Not verified:** no export or print was triggered — each writes a file to disk.

# Natyam ERP v3 — Admin

The **desktop** application for NATYAM — School of Kuchipudi. Administration, students,
admissions, attendance, fees, finance, programmes, certificates, reports and settings.

Runs entirely in the browser. **No build step, no bundler, no runtime dependencies** — plain
ES modules served as static files, exactly as the reference project did.

---

## The two apps

Natyam ERP v3 is two independent applications against one Firebase project:

| | Repository | Surface | Users |
|---|---|---|---|
| **This one** | `natyam-admin` | Desktop — sidebar navigation | Administrator, Owner & Accountant, Viewer |
| Mobile | `natyam-mobile` | Phone — bottom tab bar | Owner & Accountant, Teacher & Reception, Parents/Students (portal) |

**Owner & Accountant is the one role that uses both.** Teacher & Reception is turned away here
and pointed at the mobile app; Administrator is turned away there and pointed here.

They share the Firebase project (`natyam-erp`), Firestore collections, security rules,
authentication, roles and data model. They share **no code at runtime** — each repository holds
its own copy of the services and repositories its modules actually need.

---

## Running it locally

```bash
node tools/dev-server.cjs
```

Then open <http://localhost:8801>. Any static file server will do; the port is the only thing
this script adds over `python3 -m http.server`.

Opening `index.html` from the filesystem will **not** work — ES modules are blocked under
`file://` by browser security policy.

## Checking the module graph

There is no build step, so nothing validates imports before a browser hits them. After
changing or adding a module:

```bash
node tools/verify-imports.cjs
```

It walks every local import reachable from `js/app.js` and reports missing files, named
imports the target does not export, and files nothing reaches.

---

## ⚠️ Two things that will bite you

### 1. `firestore.rules` — this repo holds the canonical copy

Firebase enforces **one** rules document per project, and both apps read and write the same
collections. The copy in this repository is the one to edit; `natyam-mobile` carries an
identical reference copy that must never be edited independently.

Publishing is manual: Firebase Console → Firestore → Rules. It is **not** part of any git
push. If you change rules here, republish them, and copy the file to `natyam-mobile` so the
two do not drift.

### 2. A fix in shared logic must be applied twice

`js/services/` and `js/data/` are **copies**, not a shared package. A bug fixed in
`fees.service.js` here is still present in `natyam-mobile`'s copy until you apply it there
too. This was an accepted trade for genuinely independent repositories — but it is a real,
ongoing cost, not a detail.

Files copied unmodified deliberately **keep their original `NATYAM ERP 2.0` headers**, so they
can be diffed byte-for-byte against the reference project to detect drift. Only files this
migration actually rewrote carry a v3 header.

---

## Architecture

Unchanged from the reference project:

```
UI (js/modules/, js/ui/)
  ↓
Services (js/services/)        business logic
  ↓
Repositories (js/data/)        data access only
  ↓
Firebase (js/core/firebase.js)
```

- UI never talks to Firebase directly.
- Repositories answer questions about **one** collection. Anything spanning two atomically
  belongs in a service, or in the cross-collection posting helpers in
  `ledger.repository.firestore.js`.
- Capability strings, never role checks: a view asks *"can I do X"*, never *"am I an admin"*.

### What is different in v3

- **`js/config/navigation.js`** — this app's own navigation and route table. Deliberately not
  shared with `natyam-mobile`, which has a different structure. `CAPABILITIES` and `ROLES` in
  `app.config.js` are still shared, so permission logic cannot drift.
- **`assets/css/v3.css`** — the v3 design layer (warm glass over the school's stage artwork),
  implemented from the approved Claude Design project. `tokens.css` is untouched and still
  supplies the type scale, spacing grid, radii, motion and z-index.
- **No IndexedDB.** Every collection is Firestore-only.

---

## Where the data lives

Cloud Firestore, in the shared `natyam-erp` project — not in the browser. Clearing site data
does not delete records, and signing in on another device shows the same school.

`firebase.config.js` is public by design: Firebase's security comes from Security Rules and
Authentication, not from hiding that object.

---

## Documentation

| Path | What it is |
|---|---|
| `MIGRATION_CHECKLIST.md` | Every file copied, trimmed, redesigned or excluded, and why — stage by stage |
| `CHANGELOG.md` | Release notes, starting at 3.0.0 |
| `docs/design/` | Local copies of the approved Claude Design specs, plus the design system distilled from them |
| `docs/architecture/` | IAM role model, authentication providers, Firestore data model, ADRs |
| `docs/migrations/` | Historical migration notes carried over from the reference project |

## Status

**Not feature-complete.** Migrated: Dashboard, Students. Every other module renders in the
sidebar and routes to a placeholder that says so. See `MIGRATION_CHECKLIST.md`.

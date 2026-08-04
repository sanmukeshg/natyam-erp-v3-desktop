/**
 * Natyam ERP v3 — Admin — Navigation
 *
 * This app's own navigation/route table. Deliberately NOT shared with
 * natyam-mobile: the two apps have different module sets and different
 * navigation patterns (grouped sidebar here, bottom nav + more-menu there),
 * so each owns its own table rather than filtering one shared array. See
 * js/config/app.config.js's NAVIGATION note, and MIGRATION_CHECKLIST.md.
 *
 * Capability gating is unchanged from the reference app: every item still
 * names a CAPABILITIES string, and the shell renders only what
 * session.can() allows. Permission logic is shared; the *list* is not.
 *
 * `load` is a dynamic import, so a page is downloaded only when first
 * opened. **A null `load` means "module not migrated yet"** — the item is
 * still shown (the grouped sidebar is designed around the full five-group
 * structure) but routes to an honest placeholder instead of a broken import.
 * Migrating a module is therefore a one-line change here: fill in its
 * `load`. See MIGRATION_CHECKLIST.md for which stage brought each one over.
 */

import { CAPABILITIES } from './app.config.js';

export const NAVIGATION = Object.freeze([
    {
        group: 'Overview',
        icon: 'home',
        items: [
            { path: '/', label: 'Dashboard', icon: 'home', cap: null,
              load: () => import('../modules/dashboard/dashboard.page.js') }
        ]
    },
    {
        group: 'People',
        icon: 'users',
        items: [
            { path: '/admissions', label: 'Admissions', icon: 'inbox', cap: CAPABILITIES.ADMISSION_VIEW,
              load: () => import('../modules/admissions/admissions.page.js') },
            { path: '/students', label: 'Students', icon: 'users', cap: CAPABILITIES.STUDENT_VIEW,
              load: () => import('../modules/students/students.page.js') },
            { path: '/parents', label: 'Parents', icon: 'phone', cap: CAPABILITIES.STUDENT_VIEW,
              load: () => import('../modules/students/parents.page.js') },
            { path: '/staff', label: 'Staff', icon: 'briefcase', cap: CAPABILITIES.STAFF_VIEW,
              load: () => import('../modules/staff/staff.page.js') }
        ]
    },
    {
        group: 'Teaching',
        icon: 'calendar',
        items: [
            { path: '/batches', label: 'Batches', icon: 'grid', cap: CAPABILITIES.STUDENT_VIEW,
              load: () => import('../modules/batches/batches.page.js') },
            { path: '/timetable', label: 'Timetable', icon: 'calendar', cap: CAPABILITIES.STUDENT_VIEW,
              load: () => import('../modules/batches/timetable.page.js') },
            // Hidden from the sidebar, exactly as the reference app has it
            // (Milestone B2): the register is reached by clicking a class on
            // the Timetable, which links here as ?batch=…&date=…. This was
            // temporarily shown while Timetable had not migrated; now that it
            // has, the approved behaviour is restored.
            { path: '/attendance', label: 'Attendance', icon: 'check-square', cap: CAPABILITIES.ATTENDANCE_VIEW,
              hidden: true, load: () => import('../modules/attendance/attendance.page.js') },
            { path: '/programs', label: 'Programmes', icon: 'star', cap: CAPABILITIES.PROGRAM_VIEW,
              load: () => import('../modules/programs/programs.page.js') },
            { path: '/certificates', label: 'Certificates', icon: 'award', cap: CAPABILITIES.PROGRAM_VIEW,
              load: () => import('../modules/certificates/certificates.page.js') }
        ]
    },
    {
        group: 'Money',
        icon: 'wallet',
        items: [
            { path: '/fees', label: 'Fee collection', icon: 'receipt', cap: CAPABILITIES.FEE_VIEW,
              load: () => import('../modules/fees/fees.page.js') },
            { path: '/finance', label: 'Finance', icon: 'trending-up', cap: CAPABILITIES.FINANCE_VIEW,
              load: () => import('../modules/finance/finance.page.js') }
        ]
    },
    {
        group: 'Insight',
        icon: 'bar-chart',
        items: [
            { path: '/analytics', label: 'Analytics', icon: 'trending-up', cap: CAPABILITIES.REPORT_VIEW,
              load: () => import('../modules/reports/analytics.page.js') },
            /*
             * UAT ENH-202. Reports is no longer a separate navigation entry —
             * it is a section of Analytics, reached by the tab strip on that
             * page. It stays in this list because ROUTES is derived from it, so
             * removing it outright would unregister the route; `hidden` keeps
             * the route and drops the sidebar link.
             *
             * The path is nested under /analytics so the shell's existing
             * prefix match lights up Analytics while Reports is open, with no
             * special case in markActive().
             */
            { path: '/analytics/reports', label: 'Reports', icon: 'file-text',
              cap: CAPABILITIES.REPORT_VIEW, hidden: true,
              load: () => import('../modules/reports/reports.page.js') },
            { path: '/notifications', label: 'Notifications', icon: 'bell', cap: CAPABILITIES.STUDENT_VIEW,
              load: () => import('../modules/notifications/notifications.page.js') },
            { path: '/settings', label: 'Settings', icon: 'settings', cap: CAPABILITIES.SETTINGS_VIEW,
              load: () => import('../modules/settings/settings.page.js') },
            // Everyone's own account, reached from the header profile button
            // rather than the sidebar — hence `hidden`, and `cap: null` so
            // every signed-in role can actually reach it.
            { path: '/profile', label: 'My account', icon: 'user', cap: null, hidden: true,
              load: () => import('../modules/auth/profile.page.js') }
        ]
    }
]);

/** Flat route table, derived so the two can never drift apart. */
export const ROUTES = NAVIGATION.flatMap((g) => g.items);

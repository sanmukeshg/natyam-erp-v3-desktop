/**
 * Natyam ERP v3 — Admin — "not migrated yet" placeholder.
 *
 * The v3 split migrates one module at a time (see MIGRATION_CHECKLIST.md).
 * Until a module arrives, its sidebar entry still exists — the grouped
 * navigation is designed around the full five-group structure, and hiding
 * half of it would misrepresent the app — but the route has nothing to
 * mount. This says so plainly instead of throwing an unresolved import or,
 * worse, rendering an empty screen that looks like a bug.
 *
 * Nothing here is permanent: a module's migration replaces this by filling
 * in its `load` in js/config/navigation.js.
 */

import { Page } from '../../core/router.js';
import { html, render } from '../../utils/dom.js';

export function pendingPage(label) {
    return class PendingPage extends Page {
        constructor(context) {
            super(context);
            this.title = label;
        }

        async render(container) {
            render(container, html`
                <div class="v3-page-head">
                    <h1 class="v3-page-title">${label}</h1>
                    <p class="v3-page-sub">Not migrated yet</p>
                </div>
                <div class="v3-page-body">
                    <section class="v3-card">
                        <div class="v3-empty">
                            <p style="margin:0 0 8px;">
                                <strong>${label}</strong> has not been migrated into Natyam ERP v3 yet.
                            </p>
                            <p style="margin:0;">
                                It is still available in the previous version of the app.
                                See <code>MIGRATION_CHECKLIST.md</code> for what has moved so far.
                            </p>
                        </div>
                    </section>
                </div>
            `);
        }
    };
}

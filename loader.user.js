// ==UserScript==
// @name         TransPoster – סקריפטים
// @namespace    transposter.urban-digital.co.il
// @version      1.2.0
// @description  טוען את סקריפטי ההרחבה של TransPoster לפי הדף שפתוח. מתקינים אותו פעם אחת — כל השאר מגיע ומתעדכן מעצמו.
// @author       Urban Digital
// @match        https://transposter.urban-digital.co.il/*
// @include      /^https?:\/\/localhost(:\d+)?\//
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/UrbanDigital10/TransPosterUserScripts/main/loader.user.js
// @updateURL    https://raw.githubusercontent.com/UrbanDigital10/TransPosterUserScripts/main/loader.user.js
// ==/UserScript==

/*
 * The only userscript anyone installs. Everything else in this repository is a plain module
 * that this file fetches and runs, so a new feature reaches every user without anyone
 * installing anything, and a fix reaches them within minutes rather than on the manager's
 * once-a-day update check.
 *
 * Which module runs where is scripts.json, and so is which shared files it is run with. A
 * module is ordinary JavaScript - it needs no version, no metadata and no update mechanism of
 * its own. Only THIS file has a @version, and it only has to be raised when the loader itself
 * changes.
 *
 * Nothing here is part of TransPoster. The modules use only endpoints the application's own
 * pages already call, with the signed-in user's session, and write nothing back.
 */

(function () {
    'use strict';

    const BASE = 'https://raw.githubusercontent.com/UrbanDigital10/TransPosterUserScripts/main/';
    const MANIFEST = 'scripts.json';

    const CACHE_PREFIX = 'transposter-userscripts:';
    const LOG = '[TransPoster]';

    // The tag TransPoster's layout puts in the head of every page a signed-in user sees
    const ORG_META = 'org-name';

    /**
     * GitHub serves raw files with a five minute cache. `no-cache` asks the browser to
     * revalidate rather than serve from its own copy, so a push shows up as soon as GitHub
     * has it - the revalidation is a cheap 304 when nothing changed.
     */
    async function download(path) {
        const response = await fetch(BASE + path, { cache: 'no-cache' });

        if (!response.ok) {
            throw new Error(`${path} → ${response.status}`);
        }

        return response.text();
    }

    // The last copy that loaded, kept per file. A viewer with no storage (a private window,
    // blocked site data) simply goes without it.
    function remember(path, source) {
        try {
            localStorage.setItem(CACHE_PREFIX + path, source);
        } catch {
            // Nothing to do: the cache is a convenience, never the source of truth
        }
    }

    function recall(path) {
        try {
            return localStorage.getItem(CACHE_PREFIX + path);
        } catch {
            return null;
        }
    }

    /**
     * A module, from GitHub when it can be reached and from the last good copy when it
     * cannot - an office that lost its way out to GitHub keeps working with what it had.
     * The fallback is said out loud, because running yesterday's code silently is how a
     * fixed bug appears to come back.
     */
    async function load(path) {
        try {
            const source = await download(path);
            remember(path, source);

            return source;
        } catch (error) {
            const cached = recall(path);

            if (cached === null) {
                throw error;
            }

            console.warn(LOG, `${path}: לא ירד מגיטהאב, רץ מהעותק השמור`, error);

            return cached;
        }
    }

    /**
     * A module and the shared files it asked for, run as one piece of code in one scope. That
     * is what lets a shared file hand the module a function: each module still gets a scope of
     * its own, so nothing is written to the page's globals and nothing leaks between modules.
     *
     * A module that throws never takes the rest down.
     */
    function run(path, parts) {
        const source = parts
            .map(part => `// ===== ${part.path} =====\n${part.source}`)
            .join('\n;\n');

        try {
            new Function(`'use strict';\n${source}\n//# sourceURL=transposter/${path}`)();
        } catch (error) {
            console.error(LOG, `${path}: נפל בזמן ריצה`, error);
        }
    }

    /**
     * Whitespace is the only difference forgiven, on both sides: a name stored with a
     * trailing space, or with two spaces between its words, is the same organization. NFC
     * because the same Hebrew name can be stored composed or decomposed, and the two are
     * different strings until they are not.
     *
     * Nothing beyond that is forgiven - no partial match, no pattern. "נובה גו תחבורה" is
     * not "נובה גו".
     */
    function canonical(name) {
        return name.normalize('NFC').trim().replace(/\s+/g, ' ');
    }

    /**
     * The organization of the user reading this page, as the application wrote it into the
     * head. Read through the DOM rather than out of the page source: Razor HTML-encodes the
     * value and `content` hands it back decoded, and Israeli company names contain quotation
     * marks.
     *
     * No tag at all means no organization to go on - the user is signed out, or belongs to
     * none. The application only writes the tag when both are true.
     */
    function organizationHere() {
        const meta = document.querySelector(`meta[name="${ORG_META}"]`);

        return meta === null ? null : canonical(meta.content);
    }

    /**
     * Whether the modules may run for this user at all.
     *
     * The list lives in the manifest rather than in this file so that taking on a customer,
     * or dropping one, reaches everybody on their next page load - rather than waiting for
     * each user's script manager to notice a new version of the loader, which is usually once
     * a day.
     *
     * Closed unless the answer is plainly yes: no tag, or a name that is not on the list, and
     * nothing runs. That has a real cost - if this ever reaches users before the tag reaches
     * production, every script stops for every customer at once - but a gate that opens when
     * it cannot tell is not a gate.
     *
     * It is also fragile by construction, and knowingly so. The name is the organization's
     * own and an administrator can edit it from the admin screens, so a rename locks a paying
     * customer out silently until the list here is corrected. The value is fixed at sign-in on
     * top of that, so even the correction only reaches the user once they sign in again.
     */
    function permitted(manifest) {
        const organization = organizationHere();

        if (organization === null) {
            console.log(LOG, 'אין ארגון בדף — הסקריפטים לא ירוצו');

            return false;
        }

        if (!(manifest.organizations ?? []).map(canonical).includes(organization)) {
            console.log(LOG, `הארגון "${organization}" אינו ברשימת המורשים — הסקריפטים לא ירוצו`);

            return false;
        }

        return true;
    }

    /**
     * Whether a manifest entry wants this page. The patterns are regular expressions tested
     * against the whole address, so one entry can cover a page, a section or the whole site.
     */
    function appliesHere(entry) {
        return (entry.match ?? []).some(pattern => {
            try {
                return new RegExp(pattern).test(location.href);
            } catch (error) {
                console.error(LOG, `scripts.json: הביטוי "${pattern}" אינו תקין`, error);

                return false;
            }
        });
    }

    (async function main() {
        let manifest;

        try {
            manifest = JSON.parse(await load(MANIFEST));
        } catch (error) {
            console.error(LOG, 'לא הצלחתי לקרוא את רשימת הסקריפטים', error);

            return;
        }

        // After the manifest, because that is where the list of organizations comes from, and
        // before any module is fetched, so a user who is not entitled to them never asks
        // GitHub for one.
        if (!permitted(manifest)) {
            return;
        }

        const wanted = (manifest.scripts ?? []).filter(entry => entry.file && appliesHere(entry));

        // Run in the order the manifest lists them, so two modules that touch the same page
        // have an order their author chose rather than whichever download finished first
        for (const entry of wanted) {
            const path = `scripts/${entry.file}`;

            // `requires` names files in scripts/shared/. They are listed before the module so
            // that they run before it, and the same file asked for twice is fetched once.
            const paths = [
                ...new Set((entry.requires ?? []).map(name => `scripts/shared/${name}`)),
                path,
            ];

            try {
                const parts = [];

                for (const item of paths) {
                    parts.push({ path: item, source: await load(item) });
                }

                run(path, parts);
            } catch (error) {
                console.error(LOG, `${path}: לא נטען`, error);
            }
        }
    })();
})();

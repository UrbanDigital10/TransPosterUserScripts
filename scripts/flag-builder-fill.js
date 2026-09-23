// ==UserScript==
// @name         TransPoster – מילוי בנאי הדגל מתיק התחנה
// @namespace    transposter.urban-digital.co.il
// @version      1.0.0
// @description  ממלא את בנאי ראש התחנה ובנאי מדבקת השורה בנתונים שנשלחו מטאב "תמרור 505" בדף פרטי תחנה
// @match        https://transposter.urban-digital.co.il/FlagBuilder/Header*
// @match        https://transposter.urban-digital.co.il/FlagBuilder/Row*
// @include      /^https?:\/\/localhost(:\d+)?\/FlagBuilder\/(Header|Row)/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * This script is NOT part of TransPoster. It is the far end of the "שנה והפק" button in the
 * station file's flag tab: that button writes the part down and opens this page, and this
 * fills the form with it.
 *
 * The part arrives as it IS, not as it prints. A captioned line - drop only, students -
 * arrives with its destination mode and with the real destination underneath, because the
 * whole reason someone comes here is to change one of them: a stop that is about to be served
 * normally rather than for alighting only still has to show where the line actually goes.
 * The builder locks the fields its mode dictates and leaves the text sitting in them, so
 * turning the mode back to regular reveals it.
 *
 * Nothing is written back to the application, and nothing here is saved: the builder holds
 * no state of its own, which is what makes it the right place to change a part before
 * printing it without touching the station.
 */

(function () {
    'use strict';

    const LOG = '[TransPoster]';

    const HANDOFF_KEY = 'transposter-userscripts:builder-handoff';

    // Matches the station file's side. A handoff older than this was left behind rather than
    // followed, and must not fill a form someone opened later for their own reasons.
    const HANDOFF_SECONDS = 60;

    const NOTE_ID = 'tp-fill-note';
    const STYLE_ID = 'tp-fill-styles';

    const TEXT = {
        filled: 'מולא מתוך תיק התחנה. שינויים כאן אינם נשמרים לתחנה.',
        wrongPage: 'הנתונים שנשלחו שייכים לבנאי אחר, ולכן לא מילאתי דבר.',
    };

    const CSS = `
        #${NOTE_ID} {
            margin-block-end: .75rem;
            padding: .4rem .7rem;
            border-inline-start: 3px solid var(--app-blue, #5b92ff);
            background: var(--app-light, #f5f5f5);
            font-size: .85rem;
        }
    `;

    // ------------------------------------------------------------------ the builder's fields

    const byName = name => document.querySelector(`[name="${name}"]`);

    /**
     * Sets a field and tells the page. The builder rebuilds its preview from a delegated
     * `change` on .builder-root, so a value assigned in silence would show in the form and be
     * missing from the sticker beside it - and `new Event('change')` does not bubble unless it
     * is asked to.
     */
    function set(element, value) {
        if (!element) {
            return;
        }

        element.value = value ?? '';
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function check(element, checked) {
        if (!element) {
            return;
        }

        element.checked = checked;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /**
     * The language columns, first: the multi-language checkbox rewrites the first language,
     * re-applies every field lock and shows or hides the second column, so anything written
     * before it would be written into fields that are about to be rearranged.
     */
    function applyLanguages(secondaryLang) {
        check(document.getElementById('multilang-checkbox'), Boolean(secondaryLang));

        if (secondaryLang) {
            set(document.getElementById('lang-select-2'), secondaryLang);
        } else {
            set(document.getElementById('lang-select-1'), 'he');
        }
    }

    const PAGES = [
        {
            part: 'header',
            match: /\/FlagBuilder\/Header(\/|\?|$)/i,

            fill(handoff) {
                applyLanguages(handoff.secondaryLang);

                set(document.getElementById('stop-name-input-1'), handoff.stopName?.he);
                set(document.getElementById('stop-name-input-2'), handoff.stopName?.secondary);
                set(document.getElementById('stop-code-input'), handoff.stopCode);
                set(document.getElementById('stop-platform-input'), handoff.platform);
            },
        },
        {
            part: 'row',
            match: /\/FlagBuilder\/Row(\/|\?|$)/i,

            fill(handoff) {
                applyLanguages(handoff.secondaryLang);

                // The route list is read back by splitting on whitespace and commas, so one per
                // line is as good as any separator and is the easiest to edit by hand - which
                // is what someone dropping a cancelled line from the strip came here to do.
                set(byName('routes'), (handoff.routes ?? []).join('\n'));

                // Before the destination fields: the mode is what locks them
                check(document.querySelector(`input[name="dest-type"][value="${handoff.destMode ?? 'reg'}"]`), true);

                set(byName('dest-1'), handoff.dest?.he);
                set(byName('dest-2'), handoff.dest?.secondary);
                set(byName('sub-dest-1'), handoff.subDest?.he);
                set(byName('sub-dest-2'), handoff.subDest?.secondary);
            },
        },
    ];

    // ------------------------------------------------------------------ the handoff

    /** Reads the part and clears it in the same breath: it is good for one form, once. */
    function takeHandoff() {
        let raw;

        try {
            raw = localStorage.getItem(HANDOFF_KEY);
            localStorage.removeItem(HANDOFF_KEY);
        } catch {
            return null;
        }

        if (!raw) {
            return null;
        }

        try {
            const handoff = JSON.parse(raw);

            return Date.now() - (handoff.at ?? 0) > HANDOFF_SECONDS * 1000 ? null : handoff;
        } catch (error) {
            console.error(LOG, 'הנתונים שנשלחו לבנאי אינם קריאים', error);

            return null;
        }
    }

    /** Says where the form came from, so a filled builder is never mistaken for a saved one. */
    function note(text) {
        const form = document.querySelector('.builder-form');

        if (!form || document.getElementById(NOTE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);

        const box = document.createElement('div');
        box.id = NOTE_ID;
        box.textContent = text;
        form.prepend(box);
    }

    // ------------------------------------------------------------------ entry

    const page = PAGES.find(candidate => candidate.match.test(location.pathname));

    if (!page) {
        return;
    }

    const handoff = takeHandoff();

    if (!handoff) {
        return;
    }

    if (handoff.part !== page.part) {
        console.warn(LOG, TEXT.wrongPage);

        return;
    }

    try {
        page.fill(handoff);
        note(TEXT.filled);
    } catch (error) {
        console.error(LOG, 'מילוי הבנאי נכשל', error);
    }
})();

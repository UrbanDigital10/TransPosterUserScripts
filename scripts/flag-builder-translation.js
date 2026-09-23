// ==UserScript==
// @name         TransPoster – חיפוש תרגום בבנאי הדגל
// @namespace    transposter.urban-digital.co.il
// @version      1.0.0
// @description  מוסיף לשדות השפה השנייה בבנאי ראש תחנה ובבנאי מדבקת שורה כפתור שמחפש את התרגום ב-GTFS
// @match        https://transposter.urban-digital.co.il/FlagBuilder/Header*
// @match        https://transposter.urban-digital.co.il/FlagBuilder/Row*
// @include      /^https?:\/\/localhost(:\d+)?\/FlagBuilder\/(Header|Row)/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * This script is NOT part of TransPoster. It rides on top of the flag builder and reads GTFS
 * through the one endpoint the application already exposes over it - the GTFS explorer's
 * table source, see scripts/shared/gtfs-translations.js. Nothing is written back.
 *
 * What it translates differs by page, because the second-language field does:
 *
 *   /FlagBuilder/Header   the stop name
 *   /FlagBuilder/Row      the destination and the sub-destination
 *
 * Both are the same lookup. A headsign in GTFS is destination_subDestination, and the server
 * translates it one underscore-separated part at a time (FindRouteTranslateName) - which is
 * exactly the two fields the builder shows side by side.
 *
 * A field whose text the destination mode dictates is left alone. Under the guidelines in
 * force a special mode is wording written into the line: "drop only" and "limited frequency"
 * replace the destination, "seasonal" replaces the sub-destination. The builder disables the
 * fields it dictates, and that disabled flag is what is read here rather than the radio
 * buttons - whatever the rule becomes, the builder still says which fields are its own.
 */

(function () {
    'use strict';

    // ------------------------------------------------------------------ constants

    const LOG = '[TransPoster]';

    const ROOT_CLASS = 'tp-translate';
    const BUTTON_CLASS = 'tp-translate-btn';
    const NOTE_CLASS = 'tp-translate-note';

    // The application's own class for a message that reports a failure beside a field
    const NOTE_ALERT_CLASS = 'validation-alert';
    const STYLE_ID = 'tp-translate-styles';

    const TEXT = {
        button: 'חפש תרגום',
        working: 'מחפש…',
        stopName: 'שם התחנה',
        dest: 'יעד',
        subDest: 'תת־יעד',
        nothing: 'אין מה לחפש.',
        skipped: (label, caption) => `${label} נקבע על ידי המצב "${caption}".`,
        missing: labels => `לא נמצא תרגום: ${labels.join(', ')}.`,
        done: 'התרגום נמצא.',
        failed: 'חיפוש התרגום נכשל. הפרטים בקונסול.',
        noField: 'לא מצאתי את שדה השפה השנייה, ולכן לא הוספתי את הכפתור.',
    };

    const CSS = `
        .${ROOT_CLASS} {
            display: flex;
            flex-direction: column;
            align-items: start;
            gap: 4px;
            margin-block-start: 6px;
        }

        /* Producing is what the page is for, so the produce button is the one that looks like
           a button. Looking a name up is a quieter help beside a field, and takes the
           application's own link button - the same choice, for the same reason, as the "add
           platforms" link on the stop card. Not .text-small alongside it: it would repaint
           the link grey. */
        .${BUTTON_CLASS} {
            font-size: 12px;
            line-height: 1.2;
        }

        /* The field is 180px wide, so a sentence has to be allowed to wrap inside it */
        .${NOTE_CLASS} {
            font-size: 11px;
            line-height: 1.35;
        }

        /* Grey while the note is only telling you something; the application's own
           .validation-alert paints it red when it is telling you the search failed. The
           :not() keeps this rule out of that one's way - the two have the same weight, and
           this style element is appended after the application's own. */
        .${NOTE_CLASS}:not(.${NOTE_ALERT_CLASS}) {
            color: var(--app-gray, #999999);
        }
    `;

    // ------------------------------------------------------------------ the pages

    const byName = name => document.querySelector(`[name="${name}"]`);

    /**
     * What each page translates, and the field the button hangs in. The second-language field
     * is the anchor on both pages: it is the field being filled, and it is the one the builder
     * hides in single-language mode - so a button inside it disappears with it, and needs no
     * rule of its own to stay in step.
     */
    const PAGES = [
        {
            match: /\/FlagBuilder\/Header(\/|\?|$)/i,
            anchor: () => document.getElementById('stop-name-input-2'),
            pairs: () => [{
                label: TEXT.stopName,
                source: document.getElementById('stop-name-input-1'),
                target: document.getElementById('stop-name-input-2'),
            }],
        },
        {
            match: /\/FlagBuilder\/Row(\/|\?|$)/i,
            anchor: () => byName('dest-2'),
            pairs: () => [
                { label: TEXT.dest, source: byName('dest-1'), target: byName('dest-2') },
                { label: TEXT.subDest, source: byName('sub-dest-1'), target: byName('sub-dest-2') },
            ],
        },
    ];

    // ------------------------------------------------------------------ reading the builder

    const secondLang = () => document.getElementById('lang-select-2')?.value;

    const isMultiLang = () => document.getElementById('multilang-checkbox')?.checked === true;

    /** The caption the selected destination mode writes into the line, or null for a plain row. */
    function dictatedCaption() {
        const mode = document.querySelector('input[name="dest-type"]:checked')?.value;
        const words = TpFlagKeywords.he;

        switch (mode) {
            case 'drop':
                return words.dropOnly;

            case 'limited':
                return words.limitedFrequency;

            case 'seasonal':
                return words.seasonal;

            default:
                return null;
        }
    }

    const livePairs = page => page.pairs().filter(pair => pair.source && pair.target);

    const canLookUp = pair => !pair.source.disabled && pair.source.value.trim() !== '';

    // ------------------------------------------------------------------ the button

    function say(note, sentences, isBad) {
        note.textContent = sentences.filter(Boolean).join(' ');
        note.classList.toggle(NOTE_ALERT_CLASS, isBad === true);
    }

    async function fillTranslations(page, button, note) {
        const pairs = livePairs(page);

        const wanted = pairs.filter(canLookUp);
        const dictated = pairs.filter(pair => pair.source.disabled);

        // Only ever reached by a click that beat the button's own state: `refresh` kills the
        // button the moment there is nothing to look up
        if (!wanted.length) {
            say(note, [TEXT.nothing], true);

            return;
        }

        const caption = dictated.length ? dictatedCaption() : null;
        const skipped = caption ? dictated.map(pair => TEXT.skipped(pair.label, caption)) : [];

        const lang = secondLang();

        say(note, [], false);

        try {
            await tpWhileBusy(button, TEXT.working, async () => {
                const filled = [];
                const missing = [];

                for (const pair of wanted) {
                    const value = await tpFindTranslation(pair.source.value, lang);

                    if (value) {
                        pair.target.value = value;
                        filled.push(pair);
                    }
                    else {
                        missing.push(pair.label);
                    }
                }

                // The builder rebuilds its preview on `change`, and a value set from a script
                // raises none - so it is raised here, once every field has been filled
                filled.forEach(pair =>
                    pair.target.dispatchEvent(new Event('change', { bubbles: true }))
                );

                const result = missing.length ? TEXT.missing(missing) : TEXT.done;
                say(note, [result, ...skipped], missing.length > 0);
            });
        }
        catch (error) {
            console.error(LOG, 'שליפת תרגום נכשלה', error);
            say(note, [TEXT.failed], true);
        }
    }

    /**
     * A button that can do nothing says so by being dead: in single-language mode there is no
     * second-language field to fill, and a field the destination mode dictates - or an empty
     * Hebrew field - leaves nothing to look up.
     */
    function refresh(page, button) {
        button.disabled = !isMultiLang() || !livePairs(page).some(canLookUp);
    }

    function mount(page) {
        if (document.querySelector('.' + ROOT_CLASS)) {
            return;
        }

        const field = page.anchor()?.closest('.builder-field');

        if (!field) {
            console.warn(LOG, TEXT.noField);

            return;
        }

        tpInjectStyle(STYLE_ID, CSS);

        const root = tpCreate('div', ROOT_CLASS);
        const button = tpCreate('button', `btn-link ${BUTTON_CLASS}`, TEXT.button);
        const note = tpCreate('div', NOTE_CLASS);

        button.type = 'button';
        button.addEventListener('click', () => fillTranslations(page, button, note));

        root.appendChild(button);
        root.appendChild(note);
        field.appendChild(root);

        // `input` as well as `change`, so the button wakes up while the Hebrew name is still
        // being typed rather than only when the field is left
        ['change', 'input'].forEach(event =>
            document.addEventListener(event, () => refresh(page, button))
        );

        refresh(page, button);
    }

    const page = PAGES.find(candidate => candidate.match.test(location.pathname));

    if (page) {
        mount(page);
    }
})();

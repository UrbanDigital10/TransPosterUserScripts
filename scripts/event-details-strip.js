// ==UserScript==
// @name         TransPoster – הפקת סטריפ משורת פעולה
// @namespace    transposter.urban-digital.co.il
// @version      1.0.0
// @description  מוסיף לדף פרטי אירוע לחצן "הפק סטריפ" בכל פעולה שיש בה גם קווים וגם יעד, ומפיק את הסטריפ עם תרגום היעד לשפה השנייה של התחנה
// @match        https://transposter.urban-digital.co.il/Maintenance/Events/Details/*
// @include      /^https?:\/\/localhost(:\d+)?\/Maintenance\/Events\/Details\/\d+/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * This script is NOT part of TransPoster. It rides on top of the event details page and uses
 * only endpoints the application's own pages already call:
 *
 *   GET  /Stops/Details/{id}             the stop page, for the stop's second flag language
 *   POST /GtfsExplorer/Translations/...  the GTFS translations table (shared/gtfs-translations.js)
 *   POST /flag-builder/produce           the flag producer (shared/flag-produce.js)
 *
 * Nothing is written back to the application.
 *
 * An action that names both routes and a destination describes a strip, so it can be printed
 * as one. The destination field holds "destination, sub-destination" - the comma is what the
 * work order is written with - and each part is translated on its own, which is also how a
 * headsign's underscore-separated parts are translated.
 */

(function () {
    'use strict';

    // ------------------------------------------------------------------ constants

    const URLS = {
        stopPage: id => `/Stops/Details/${id}`,
    };

    const ACTIONS_TABLE = '#actions-table';
    const WORKS_TABLE = '#works-table';

    const CELL_CLASS = 'tpstrip-cell';

    const TEXT = {
        produce: 'הפק סטריפ',
        producing: 'מפיק…',
        trying: span => `מנסה גובה ${span}…`,
        produced: span => `הופק (${span === 1 ? 'שורה אחת' : `${span} שורות`})`,
        hebrewOnly: 'אין תרגום — עברית בלבד',
        noSubDest: 'אין תרגום ליעד המשנה',
        noStop: 'לא הצלחתי לזהות את התחנה של פקודת העבודה, ולכן אין שפה שנייה להפיק בה.',
        failed: message => `ההפקה נכשלה: ${message}`,
    };

    const CSS = `
        /* 1% is how a table cell is told to take only what it needs: the columns beside it
           are laid out by the page, and this one should cost them as little as it can */
        #actions-table .${CELL_CLASS} {
            inline-size: 1%;
            white-space: nowrap;
            vertical-align: middle;
        }

        /* Under the button rather than beside it, so a row that says something does not widen
           the column and shove the audit comments off the card. It is written one short line
           at a time and never wrapped, so a row grows by a line rather than by a paragraph. */
        #actions-table .${CELL_CLASS} .tpstrip-note {
            font-size: .75rem;
            line-height: 1.3;
            margin-block-start: .25rem;
            white-space: pre;
            opacity: .75;
        }

        /* What went wrong is worth the width, and is the one thing here allowed to wrap */
        #actions-table .${CELL_CLASS} .tpstrip-note.tpstrip-bad {
            color: var(--app-red, #FF6060);
            white-space: pre-line;
            max-inline-size: 26ch;
            opacity: 1;
        }
    `;

    // ------------------------------------------------------------------ small helpers

    function create(tag, className, text) {
        const node = document.createElement(tag);

        if (className) {
            node.className = className;
        }

        if (text != null) {
            node.textContent = text;
        }

        return node;
    }

    /**
     * A field of a JSON response by name, whichever case the endpoint spelled it in. The
     * application's endpoints disagree: this.JsonDefaultContract(...) keeps PascalCase while a
     * plain Json(...) comes back camelCase, and two endpoints on one controller can differ.
     * Reading by one spelling yields undefined against the other - silently.
     */
    function field(source, name) {
        const key = Object.keys(source ?? {}).find(k => k.toLowerCase() === name.toLowerCase());

        return key === undefined ? undefined : source[key];
    }

    /** The parts of a comma-separated field, empties dropped. */
    const parts = value => (value ?? '').split(',').map(part => part.trim()).filter(Boolean);

    function injectStyles() {
        if (!document.getElementById('tpstrip-styles')) {
            const style = create('style');
            style.id = 'tpstrip-styles';
            style.textContent = CSS;
            document.head.appendChild(style);
        }
    }

    // ------------------------------------------------------------------ reading the page

    const isTable = selector => $.fn.dataTable?.isDataTable(selector) === true;

    /**
     * The stop of the work whose actions are on screen. The works table carries it on the row
     * itself - StopId is what its stop link is built from - so no second request is needed to
     * learn which stop the actions below it belong to.
     */
    function selectedStop() {
        if (!isTable(WORKS_TABLE)) {
            return null;
        }

        const row = $(WORKS_TABLE).DataTable().row('.selected');

        if (!row.length) {
            return null;
        }

        const data = row.data();

        return { id: field(data, 'StopId'), code: field(data, 'StopCode') };
    }

    /** The row's data as the actions table holds it, for the cells that render as plain text. */
    function rowData(row) {
        if (!isTable(ACTIONS_TABLE)) {
            return null;
        }

        const dtRow = $(ACTIONS_TABLE).DataTable().row(row);

        return dtRow.length ? dtRow.data() : null;
    }

    /**
     * What a row says in one field. The cell renders as an input while the table may be
     * written in and as plain text otherwise, so the input has the last word when there is one
     * - it holds what the user has typed, which may not have been saved yet.
     */
    function fieldValue(row, name) {
        const input = row.querySelector(`input[name="${name}"]`);

        return input ? input.value : (field(rowData(row), name) ?? '');
    }

    // ------------------------------------------------------------------ the stop's second language

    /*
     * The flag's second language is the stop's, and the stop page is where it is written down.
     *
     * It is read out of the page's own formModel JSON rather than off the #flag-secondary-lang
     * select, because that select is NEVER marked selected in the HTML the server renders:
     * EnumsSelectListHelper passes the enum's NAME as the selected value ("English") while the
     * options carry its underlying NUMBER ("1"), so nothing ever matches. The page does not
     * notice, because Vue sets the value from formModel a moment later - but a reader of the
     * raw HTML would get "Arabic" for every stop in the country.
     *
     * In that JSON it is a plain number: SerializeJsonHelper registers no converter, so the
     * enum is not spelled {Name, Value} the way the endpoints that use EnumValueNameConverter
     * spell theirs.
     */
    const SECONDARY_LANG_FIELD = /"FlagSecondaryLang"\s*:\s*(\d+|null)/;

    const langCache = new Map();

    function secondaryLangOf(stopId) {
        if (!langCache.has(stopId)) {
            langCache.set(stopId, readSecondaryLang(stopId).catch(error => {
                // A failed read is not an answer worth keeping - the next click asks again
                langCache.delete(stopId);

                throw error;
            }));
        }

        return langCache.get(stopId);
    }

    async function readSecondaryLang(stopId) {
        const url = URLS.stopPage(stopId);

        const response = await fetch(url, { credentials: 'same-origin' });

        if (!response.ok) {
            throw new Error(`${url} → ${response.status}`);
        }

        const match = SECONDARY_LANG_FIELD.exec(await response.text());

        // Lang is Arabic 0, English 1. English is what MainStop itself defaults to, so it is
        // also the answer for a stop whose page names no language at all.
        return match?.[1] === '0' ? 'ar' : 'en';
    }

    // ------------------------------------------------------------------ one strip

    /**
     * The strip an action describes. The destination field is written "destination,
     * sub-destination"; a field with no comma is a destination alone. Anything past the second
     * part is dropped, because a strip has two lines of text and nowhere to put a third.
     */
    function stripOf(row) {
        const routes = parts(fieldValue(row, 'routeList'));
        const destination = parts(fieldValue(row, 'destination'));

        return { routes, dest: destination[0] ?? '', subDest: destination[1] ?? '' };
    }

    const panel = (lang, dest, subDest, routes) => ({ lang, destType: 'reg', dest, subDest, routes });

    /**
     * Produces one action's strip, and returns what should be said about it afterwards.
     *
     * An untranslated destination prints in Hebrew alone rather than over an empty half:
     * putting the Hebrew text on the second panel would make the producer set it in the
     * second language's direction, which turns the Hebrew round. The destination is what
     * decides - a sub-destination left untranslated only costs the second panel its lower line.
     */
    async function produceFor(strip, stop, onAttempt) {
        const lang = await secondaryLangOf(stop.id);

        const dest = await tpFindTranslation(strip.dest, lang);
        const subDest = strip.subDest ? await tpFindTranslation(strip.subDest, lang) : '';

        const hebrew = panel('he', strip.dest, strip.subDest, strip.routes);

        const sides = dest === null
            ? [hebrew]
            : [hebrew, panel(lang, dest, subDest ?? '', strip.routes)];

        const rowSpan = await tpProduceStrip(
            sides,
            `סטריפ-${stop.code ?? ''}-${strip.routes.join('-')}.pdf`,
            onAttempt);

        const notes = [TEXT.produced(rowSpan)];

        if (dest === null) {
            notes.push(TEXT.hebrewOnly);
        } else if (strip.subDest && subDest === null) {
            notes.push(TEXT.noSubDest);
        }

        return notes.join('\n');
    }

    // ------------------------------------------------------------------ the column

    /**
     * The column the buttons live in. It is appended to the rows rather than declared as a
     * DataTables column, because the table belongs to the page: a column cannot be added to a
     * table already initialised, and re-initialising it would take the page's own handlers
     * down with it. So every row is given the cell back after each draw.
     */
    function ensureHeaderCell(table) {
        const headRow = table.tHead?.rows[0];

        if (headRow && !headRow.querySelector(`.${CELL_CLASS}`)) {
            headRow.appendChild(create('th', CELL_CLASS));
        }
    }

    function cellOf(row) {
        let cell = row.querySelector(`.${CELL_CLASS}`);

        if (!cell) {
            cell = create('td', CELL_CLASS);
            row.appendChild(cell);
        }

        return cell;
    }

    /**
     * The button of one row, or an empty cell when the action describes no strip. The cell is
     * given to every row either way, so that the rows keep the width of the header above them.
     */
    function decorateRow(row) {
        // The "no data" placeholder is one cell spanning the table, and has no action on it.
        // It is told apart by that span rather than by its class, which DataTables renamed
        // from dataTables_empty to dt-empty between the versions the application has shipped.
        if (row.querySelector('td[colspan]')) {
            return;
        }

        const cell = cellOf(row);
        const strip = stripOf(row);

        const wanted = strip.routes.length > 0 && strip.dest !== '';

        if (!wanted) {
            cell.textContent = '';

            return;
        }

        if (cell.querySelector('.tpstrip-btn')) {
            return;
        }

        const note = create('div', 'tpstrip-note');

        const button = create('button', 'btn btn-sm btn-dark tpstrip-btn', TEXT.produce);
        button.type = 'button';

        button.addEventListener('click', () => run(button, note, row));

        cell.append(button, note);
    }

    /** One button, one job at a time, and whatever went wrong said out loud on the row itself. */
    async function run(button, note, row) {
        const label = button.textContent;

        button.disabled = true;
        button.textContent = TEXT.producing;
        note.className = 'tpstrip-note';
        note.textContent = '';

        try {
            const stop = selectedStop();

            if (!stop?.id) {
                throw new Error(TEXT.noStop);
            }

            // Read again on click rather than when the button was made: the fields are edited
            // in place, and what is on screen now is what should be printed
            note.textContent = await produceFor(stripOf(row), stop, span => (note.textContent = TEXT.trying(span)));
        } catch (error) {
            note.className = 'tpstrip-note tpstrip-bad';
            note.textContent = TEXT.failed(error.message);
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    }

    function decorate() {
        const table = document.querySelector(ACTIONS_TABLE);

        if (!table) {
            return;
        }

        ensureHeaderCell(table);

        for (const row of table.tBodies[0]?.rows ?? []) {
            decorateRow(row);
        }
    }

    // ------------------------------------------------------------------ entry

    function mount() {
        injectStyles();

        // Delegated, because the actions table is built by the page's own script for the work
        // that is selected - which may be long after this runs, and again on every selection
        $(document).on('draw.dt', ACTIONS_TABLE, () => decorate());

        // A row is redrawn when it is saved, but an action with no type set is not saved at
        // all - so a destination typed into one would otherwise never grow its button
        $(document).on('change', `${ACTIONS_TABLE} input`, () => decorate());

        decorate();
    }

    mount();
})();

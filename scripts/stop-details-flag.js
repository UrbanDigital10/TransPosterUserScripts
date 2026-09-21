// ==UserScript==
// @name         TransPoster – תמרור 505
// @namespace    transposter.urban-digital.co.il
// @version      1.0.0
// @description  מוסיף לדף פרטי תחנה טאב "תמרור 505": דגל התחנה לפי טאב הקווים, עברית ושפה שנייה זו לצד זו, עם הפקת ראש תחנה ומדבקות שורה
// @match        https://transposter.urban-digital.co.il/Stops/Details/*
// @include      /^https?:\/\/localhost(:\d+)?\/Stops\/Details\/\d+/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * This script is NOT part of TransPoster. It rides on top of the stop details page and uses
 * only endpoints the page itself already calls:
 *
 *   GET  /Stops/Routes/{id}     the routes list behind the "קווים" tab
 *   GET  /Stops/Translation     the stop name in Arabic and English
 *   POST /flag-builder/produce  the endpoint the flag builder posts to
 *
 * Nothing is written back to the application.
 *
 * The destination rules below mirror the server's FlagRules / FlagRouteRules: drop-only
 * outranks students, which outranks seasonal; a captioned line gives up its sub-destination,
 * a seasonal one gives up only that.
 *
 * How tall a strip has to be is NOT worked out here. Measuring it in the browser, the way the
 * builder's preview does, disagrees with the produce service - a strip the preview called a
 * fit came back 500. So the service is asked instead: the strip is produced at height 1, and
 * on failure again one row taller, up to the 8 rows a flag holds. The first height that
 * answers with a PDF is the one printed.
 */

(function () {
    'use strict';

    // ------------------------------------------------------------------ constants

    const PANE_ID = 'tp505-pane';
    const TAB_ID = 'tp505-tab';

    // A strip is one row high unless its route numbers do not fit. A flag is 8 rows tall, so a
    // strip the service still refuses at 8 cannot be printed at all.
    const MAX_ROW_SPAN = 8;

    const URLS = {
        routes: id => `/Stops/Routes/${id}`,
        translation: name => `/Stops/Translation?stopName=${encodeURIComponent(name)}`,
        produce: '/flag-builder/produce',
        busIcon: '/areas/flag-builder/images/stop-head-bus.svg',
    };

    // Mirrors LineAppColors. The exclusivity colour is what tells a line apart - plus, for this
    // tab, a row the routes table paints yellow (IsSeasonal), which is the seasonal feed.
    const COLORS = {
        STUDENTS: 'תלמידים',
        SEA: 'ים',
    };

    const TEXT = {
        tabTitle: 'תמרור 505',
        loading: 'טוען את הדגל…',
        produceHead: 'הפק ראש תחנה',
        produceRow: 'הפק מדבקת שורה',
        producing: 'מפיק…',
        noPlatform: 'ללא רציף',
        platformLabel: 'רציף',
        noRoutes: 'אין קווים בתחנה הזו, ולכן אין דגל להציג.',
        noRoutesForPlatform: 'אין קווים ברציף שנבחר.',
        missingTranslation: 'אין תרגום',
        stopCodeNotFound: 'לא הצלחתי לקרוא את מקט התחנה מהדף, ולכן אי אפשר להפיק ראש תחנה.',
        loadFailed: 'טעינת רשימת הקווים נכשלה',
        produceFailed: 'ההפקה נכשלה',
        notAllowed: 'נראה שאין לך הרשאה לבנאי הדגל, ובלעדיה אי אפשר להפיק.',
        serverError: status => `שירות ההפקה החזיר שגיאה ${status}.`,
        trying: span => `מנסה גובה ${span}…`,
        noFit: status => `ניסיתי להפיק בכל הגבהים מ-1 עד ${MAX_ROW_SPAN} וכולם נכשלו (שגיאה אחרונה: ${status}).`
            + ' ייתכן שהסטריפ לא נכנס גם בגובה מלא, או ששירות ההפקה אינו זמין.',
        rowSpan: span => (span === 1 ? 'שורה אחת' : `${span} שורות`),
    };

    const CSS = `
        #${PANE_ID} { padding: 1rem 0; }

        #${PANE_ID} .tp505-bar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: .75rem;
            margin-block-end: .75rem;
        }

        #${PANE_ID} .tp505-bar label { margin: 0; font-size: .85rem; }

        /* A screen too narrow for the four columns scrolls the flag rather than the page */
        #${PANE_ID} .tp505-scroll { overflow-x: auto; }

        /* The flag is a black board the cells sit on, so every gap between them reads as the
           black frame it is on the printed flag. */
        #${PANE_ID} .tp505-flag {
            display: grid;
            grid-template-columns: 7rem minmax(10ch, 1fr) minmax(10ch, 1fr) max-content;
            gap: 2px;
            padding: 2px;
            background: #000;
            max-width: 62rem;
            align-items: stretch;
        }

        #${PANE_ID} .tp505-cell {
            background: #ffc000;
            padding: .4rem .6rem;
            display: flex;
            flex-direction: column;
            justify-content: center;
            min-block-size: 2.9rem;
            overflow-wrap: anywhere;
        }

        /* The head prints white on the flag, and the bus square blue */
        #${PANE_ID} .tp505-cell.tp505-head { background: #fff; font-weight: 700; }
        #${PANE_ID} .tp505-cell.tp505-icon { background: #376fff; padding: .4rem; }
        #${PANE_ID} .tp505-icon img { inline-size: 100%; display: block; }

        /* The line numbers wrap across the cell the way they wrap across the printed strip,
           rather than stacking one per line - a strip of eight lines would be a tower. */
        #${PANE_ID} .tp505-num {
            flex-direction: row;
            flex-wrap: wrap;
            align-items: center;
            justify-content: center;
            gap: 0 .45rem;
            font-size: 1.2rem;
            font-weight: 700;
            text-align: center;
            line-height: 1.25;
        }

        #${PANE_ID} .tp505-dest { font-weight: 600; }
        #${PANE_ID} .tp505-subdest { font-size: .8rem; font-weight: 400; }
        #${PANE_ID} .tp505-missing { font-size: .8rem; font-weight: 400; opacity: .7; }

        /* A cell with nothing to print in its language, in the application's own warning wash
           (color.css). It is laid on as a background IMAGE so that it tints whatever the cell
           already is - white on the head, yellow on a strip - instead of replacing it.
           The border carries the mark rather than the wash: over the strip's yellow the wash
           alone only deepens it, and reads as another shade of strip rather than as a flag. */
        #${PANE_ID} .tp505-cell.tp505-untranslated {
            background-image: linear-gradient(var(--app-warning, #ff5b5b33), var(--app-warning, #ff5b5b33));
            box-shadow: inset 0 0 0 2px var(--app-red, #ff6060);
        }

        /* The control column is white like the symbol column of a real flag, so it reads as
           part of the board rather than as a table glued to its side. */
        #${PANE_ID} .tp505-act {
            background: #fff;
            align-items: stretch;
            gap: .2rem;
            padding: .3rem;
        }

        #${PANE_ID} .tp505-act .btn { white-space: nowrap; }
        #${PANE_ID} .tp505-note { font-size: .75rem; text-align: center; opacity: .7; }
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

    const distinct = values => [...new Set(values)];

    const alertBox = (kind, text) => create('div', `alert alert-${kind} py-2`, text);

    /**
     * A field of a JSON response by name, whichever case the endpoint spelled it in. The stop
     * page's own endpoints disagree: /Stops/Routes goes through JsonDefaultContract, which
     * pins PropertyNamingPolicy to null and keeps PascalCase, while /Stops/Translation uses
     * the controller's plain Json() and comes back camelCase. Reading by one spelling yields
     * undefined against the other - silently, which is how the stop head lost its translation.
     */
    function field(source, name) {
        const key = Object.keys(source ?? {}).find(k => k.toLowerCase() === name.toLowerCase());

        return key === undefined ? undefined : source[key];
    }

    async function getJson(url) {
        const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });

        if (!response.ok) {
            throw new Error(`${url} → ${response.status}`);
        }

        return response.json();
    }

    // ------------------------------------------------------------------ reading the page

    /**
     * The stop as the page shows it. The id is in the address; the name and the code are read
     * off the details card, where they are its first two items - and the code is the one that
     * is all digits, which is what tells the two apart if the card ever grows a field.
     */
    function readStop() {
        const id = Number(location.pathname.split('/').filter(Boolean).pop());

        const values = [...document.querySelectorAll('.stop-details .details-item')]
            .map(item => item.querySelector('span:last-child')?.textContent?.trim() ?? '');

        return {
            id: Number.isInteger(id) ? id : null,
            name: values[0] ?? '',
            code: values.slice(1).find(value => /^\d{1,7}$/.test(value)) ?? null,
        };
    }

    /** The flag's secondary language, as the settings card has it. Lang: 0 Arabic, 1 English. */
    const readSecondaryLang = () => (document.getElementById('flag-secondary-lang')?.value === '0' ? 'ar' : 'en');

    // ------------------------------------------------------------------ flag derivation

    /** Mirrors StopDescHelper.GetAddressPart. */
    function getAddressPart(description, part) {
        const start = description.indexOf(part + ':');

        if (start === -1) {
            return null;
        }

        let rest = description.substring(start + part.length + 1);
        const next = rest.indexOf(':');

        if (next > 0) {
            const lastSpace = rest.substring(0, next).lastIndexOf(' ');
            rest = rest.substring(0, lastSpace > 0 ? lastSpace : next);
        }

        return rest.trim();
    }

    /** Mirrors PlatformHelper.ExtractPlatform: the "רציף:3" format first, then "name_3". */
    function extractPlatform(source) {
        if (!source || !source.trim()) {
            return null;
        }

        const token = (getAddressPart(source, TpFlagKeywords.he.platform) ?? source.split('_').pop() ?? '').trim();

        return token || null;
    }

    /** Mirrors RouteNumHelper.AsNumber: the line number, with a trailing Hebrew letter as a tenth. */
    function routeNumAsNumber(routeNum) {
        const match = /(\d{1,3})([א-ת])?/.exec(routeNum ?? '');

        if (!match) {
            return Number.MAX_SAFE_INTEGER;
        }

        const num = Number(match[1]);

        return match[2] ? num + (match[2].codePointAt(0) - 0x05d0 + 1) / 10 : num;
    }

    /** Mirrors FlagRouteRules.SplitHeadsign: the headsign is "destination_refinement". */
    function splitHeadsign(headsign) {
        const value = (headsign ?? '').trim();

        if (!value) {
            return { dest: '', subDest: '' };
        }

        const parts = value.split('_');

        return { dest: parts[0], subDest: parts.length > 1 ? parts[parts.length - 1] : '' };
    }

    /**
     * The numeric value of an enum field. The routes endpoint writes enums through
     * EnumValueNameConverter, which spells them {Name, Value} rather than as a number - and a
     * bitwise test against that object silently yields NaN, which read as "no pickup" and put
     * every line in the station on one "הורדה בלבד" strip. A plain number is still accepted,
     * so dropping the converter would not break this again.
     */
    const enumValue = value => (value !== null && typeof value === 'object' ? value.Value : value);

    /**
     * What a line is, in the vocabulary the builder's destination modes use. The precedence is
     * the captions': drop-only, then students, then seasonal.
     */
    function destModeOf(route) {
        // StopType is a flags enum - Pickup 1, Drop 2, PickupAndDrop 3. A stop the line does
        // not pick up at is what makes it drop-only, exactly as the flag derivation decides it.
        if (!(enumValue(route.StopType) & 1)) {
            return 'drop';
        }

        if (route.Color === COLORS.STUDENTS) {
            return 'limited';
        }

        if (route.Color === COLORS.SEA || route.IsSeasonal) {
            return 'seasonal';
        }

        return 'reg';
    }

    /** Regular lines first, then limited frequency, then drop-only. */
    const bucketOf = mode => (mode === 'drop' ? 2 : mode === 'limited' ? 1 : 0);

    /**
     * Mirrors resolveDestMode in the builder: a special mode is wording written into the
     * destination line. A captioned line says only its caption; a seasonal one keeps its
     * destination and gives up its sub-destination.
     */
    function resolveDest(lang, mode, parts) {
        const words = TpFlagKeywords[lang];

        switch (mode) {
            case 'drop':
                return { dest: words.dropOnly, subDest: '' };

            case 'limited':
                return { dest: words.limitedFrequency, subDest: '' };

            case 'seasonal':
                return { dest: parts.dest, subDest: words.seasonal };

            default:
                return parts;
        }
    }

    /**
     * The strips of the flag: lines that print the same destination and sub-destination are one
     * strip, listed by their line numbers. Groups run in caption order, and within a group by
     * the lowest line number in it.
     */
    function buildStrips(routes, secondaryLang) {
        const strips = new Map();

        for (const route of routes) {
            const mode = destModeOf(route);

            const secondHeadsign = secondaryLang === 'ar' ? route.HeadsignArabic : route.HeadsignEnglish;

            const hebrew = resolveDest('he', mode, splitHeadsign(route.Headsign));
            const secondary = resolveDest(secondaryLang, mode, splitHeadsign(secondHeadsign));

            // Grouped on what the Hebrew panel shows, the way the audit card groups its strips:
            // what the reader sees is the only thing that tells rows apart.
            const key = `${bucketOf(mode)}|${hebrew.dest}|${hebrew.subDest}`;

            let strip = strips.get(key);

            if (!strip) {
                strip = { bucket: bucketOf(mode), hebrew, secondary, routes: [] };
                strips.set(key, strip);
            }

            strip.routes.push(route.RouteName);
        }

        for (const strip of strips.values()) {
            strip.routes = distinct(strip.routes).sort((a, b) => routeNumAsNumber(a) - routeNumAsNumber(b));
        }

        return [...strips.values()].sort((a, b) =>
            a.bucket - b.bucket || routeNumAsNumber(a.routes[0]) - routeNumAsNumber(b.routes[0]));
    }

    // ------------------------------------------------------------------ production

    /**
     * One production attempt. A PDF is the only success. A refusal and a sign-in page answered
     * as HTML - which is what a user without the flag-builder permission gets - are dead ends;
     * anything else is a failure the caller may retry one row taller.
     */
    async function attemptProduce(type, payload) {
        const response = await fetch(URLS.produce, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/pdf' },
            body: JSON.stringify({ type, data: JSON.stringify(payload) }),
        });

        if (response.status === 401 || response.status === 403) {
            return { fatal: TEXT.notAllowed };
        }

        if (!response.ok) {
            return { status: response.status };
        }

        if (!(response.headers.get('content-type') ?? '').includes('pdf')) {
            return { fatal: TEXT.notAllowed };
        }

        return { blob: await response.blob() };
    }

    function download(blob, fileName) {
        const url = URL.createObjectURL(blob);

        const link = create('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
    }

    /**
     * How tall the strip has to be, asked of the service rather than guessed: produced at one
     * row, and on failure again a row taller. The first height that answers with a PDF is the
     * one printed, and it is returned so the row can say what it got.
     *
     * Each attempt is reported as it starts, so a strip that takes several rounds shows what
     * it is doing instead of sitting silent.
     */
    async function produceStrip(sides, fileName, onAttempt) {
        let lastStatus = null;

        for (let rowSpan = 1; rowSpan <= MAX_ROW_SPAN; rowSpan++) {
            onAttempt(rowSpan);

            const result = await attemptProduce('row', sides.map(side => ({ ...side, rowSpan })));

            if (result.fatal) {
                throw new Error(result.fatal);
            }

            if (result.blob) {
                download(result.blob, fileName);

                return rowSpan;
            }

            lastStatus = result.status;
        }

        throw new Error(TEXT.noFit(lastStatus));
    }

    /** The head is one row tall by definition, so it is produced once or not at all. */
    /**
     * The language panels a part is produced with, given the Hebrew one and the secondary one
     * or null. A part whose secondary language has no text of its own prints Hebrew alone:
     * putting the Hebrew text on the second panel makes the producer set it in the secondary
     * language's direction, which turns the Hebrew round, and an empty panel prints a blank
     * half. One panel is what the builder itself produces in single-language mode.
     */
    const panelsFor = (hebrew, secondary) => (secondary === null ? [hebrew] : [hebrew, secondary]);

    async function produceHead(payload, fileName) {
        const result = await attemptProduce('header', payload);

        if (!result.blob) {
            throw new Error(result.fatal ?? TEXT.serverError(result.status));
        }

        download(result.blob, fileName);
    }


    // ------------------------------------------------------------------ the tab

    function mount() {
        const routesTab = document.getElementById('routes-tab');
        const routesPane = document.getElementById('routes');

        if (!routesTab || !routesPane || document.getElementById(TAB_ID)) {
            return;
        }

        document.head.appendChild(Object.assign(create('style'), { textContent: CSS }));

        const button = create('button', 'nav-link', TEXT.tabTitle);
        button.id = TAB_ID;
        button.type = 'button';
        button.setAttribute('role', 'tab');
        button.dataset.bsToggle = 'tab';
        button.dataset.bsTarget = `#${PANE_ID}`;

        const item = create('li', 'nav-item');
        item.setAttribute('role', 'presentation');
        item.appendChild(button);
        routesTab.closest('ul.nav-tabs').appendChild(item);

        const pane = create('div', 'tab-pane fade');
        pane.id = PANE_ID;
        pane.setAttribute('role', 'tabpanel');
        pane.setAttribute('aria-labelledby', TAB_ID);
        routesPane.parentElement.appendChild(pane);

        // The routes are fetched when the tab is first opened rather than on every page load:
        // the stop page is opened far more often than this tab is
        button.addEventListener('shown.bs.tab', () => load(pane), { once: true });
    }

    async function load(pane) {
        pane.textContent = TEXT.loading;

        const stop = readStop();
        const secondaryLang = readSecondaryLang();

        let routes;
        let translation;

        try {
            [routes, translation] = await Promise.all([
                getJson(URLS.routes(stop.id)),
                getJson(URLS.translation(stop.name)).catch(() => ({})),
            ]);
        } catch (error) {
            pane.textContent = '';
            pane.appendChild(alertBox('danger', `${TEXT.loadFailed}: ${error.message}`));

            return;
        }

        render({
            pane,
            stop,
            secondaryLang,
            routes,
            secondaryName: field(translation, secondaryLang === 'ar' ? 'ArabicName' : 'EnglishName') ?? '',

            // A string is one platform, '' being the lines that belong to no platform of their
            // own. null means nothing has been chosen yet: the first render settles it, either
            // on the first platform or - at a stop that has none - on the stop itself.
            platform: null,
        });
    }

    /** The platforms the routes name, ordered the way platform numbers order. */
    function platformsOf(routes) {
        return distinct(routes.map(route => extractPlatform(route.SubStopName)).filter(Boolean))
            .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b));
    }

    function render(state) {
        const { pane, stop } = state;

        pane.textContent = '';

        if (state.routes.length === 0) {
            pane.appendChild(alertBox('secondary', TEXT.noRoutes));

            return;
        }

        const platforms = platformsOf(state.routes);

        // Each platform of a stop carries a flag of its own, so there is no flag of the whole
        // stop to fall back on: the first platform is what the tab opens on
        state.platform ??= platforms[0] ?? null;

        if (platforms.length > 0) {
            pane.appendChild(platformBar(state, platforms));
        }

        const routes = state.platform === null
            ? state.routes
            : state.routes.filter(route => (extractPlatform(route.SubStopName) ?? '') === state.platform);

        // A stop the page does not name a code for stays named so for as long as the tab is
        // open - it is the reason the head button is dead, and outlives any one click
        if (!stop.code) {
            pane.appendChild(alertBox('warning', TEXT.stopCodeNotFound));
        }

        // Whatever a click has to say - a failed production, a strip that would not fit - is
        // said here, above the flag, and cleared when the next click starts
        const problems = create('div');
        pane.appendChild(problems);

        if (routes.length === 0) {
            pane.appendChild(alertBox('secondary', TEXT.noRoutesForPlatform));

            return;
        }

        const scroll = create('div', 'tp505-scroll');
        const flag = create('div', 'tp505-flag');
        scroll.appendChild(flag);
        pane.appendChild(scroll);

        appendHeadRow(flag, state, problems);

        for (const strip of buildStrips(routes, state.secondaryLang)) {
            appendStripRow(flag, state, strip, problems);
        }
    }

    function platformBar(state, platforms) {
        const bar = create('div', 'tp505-bar');

        const select = create('select', 'form-select form-select-sm w-auto');
        select.id = 'tp505-platform';

        // The option's value is its index into this list, so a platform can be named anything
        // without colliding with the one entry that is not a platform
        const choices = platforms.map(platform => ({
            value: platform,
            text: `${TEXT.platformLabel} ${platform}`,
        }));

        // A line the stop never assigned to a platform belongs to no flag here, which is a gap
        // in the data rather than a line to drop - it gets a place of its own so it is seen
        if (state.routes.some(route => !extractPlatform(route.SubStopName))) {
            choices.push({ value: '', text: TEXT.noPlatform });
        }

        choices.forEach((choice, index) => {
            const option = create('option', null, choice.text);
            option.value = String(index);
            select.appendChild(option);
        });

        select.selectedIndex = Math.max(0, choices.findIndex(choice => choice.value === state.platform));

        select.addEventListener('change', () => {
            state.platform = choices[Number(select.value)].value;
            render(state);
        });

        const label = create('label', null, TEXT.platformLabel);
        label.htmlFor = select.id;

        bar.append(label, select);

        return bar;
    }

    // ------------------------------------------------------------------ rows

    function appendCell(flag, className, build) {
        const cell = create('div', `tp505-cell ${className}`);
        build?.(cell);
        flag.appendChild(cell);

        return cell;
    }

    function appendTextCell(flag, className, lang, dest, subDest) {
        return appendCell(flag, className, cell => {
            cell.lang = lang;
            cell.dir = lang === 'en' ? 'ltr' : 'rtl';

            // Marked rather than reworded: the cell still says what is missing, and the wash
            // is what catches the eye when scanning a flag for the gaps
            cell.classList.toggle('tp505-untranslated', !dest);

            cell.appendChild(dest
                ? create('span', 'tp505-dest', dest)
                : create('span', 'tp505-missing', TEXT.missingTranslation));

            if (subDest) {
                cell.appendChild(create('span', 'tp505-subdest', subDest));
            }
        });
    }

    /** What the head will print under the name: "תחנה 12345", and the platform when there is one. */
    function headSubtitle(lang, stop, platform) {
        const words = TpFlagKeywords[lang];

        const parts = [stop.code ? `${words.stop} ${String(stop.code).padStart(5, '0')}` : ''];

        if (platform) {
            parts.push(`${words.platform} ${platform}`);
        }

        return parts.filter(Boolean).join(' · ');
    }

    function appendHeadRow(flag, state, problems) {
        const { stop, secondaryLang } = state;

        // The head is printed for the selected platform; the whole station prints no platform
        const platform = state.platform ?? '';

        appendCell(flag, 'tp505-num tp505-icon tp505-head', cell => {
            const image = create('img');
            image.src = URLS.busIcon;
            image.alt = '';

            // An icon that cannot be had leaves the cell empty rather than broken
            image.addEventListener('error', () => {
                image.remove();
                cell.classList.remove('tp505-icon');
            }, { once: true });

            cell.appendChild(image);
        });

        appendTextCell(flag, 'tp505-head', 'he', stop.name, headSubtitle('he', stop, platform));

        appendTextCell(flag, 'tp505-head', secondaryLang, state.secondaryName,
            headSubtitle(secondaryLang, stop, platform));

        appendCell(flag, 'tp505-act tp505-head', cell => {
            const button = create('button', 'btn btn-sm btn-dark', TEXT.produceHead);
            button.type = 'button';
            button.disabled = !stop.code;

            button.addEventListener('click', () => run(button, problems, () => {
                const panel = (lang, stopName) => ({ lang, stopName, stopCode: stop.code, platform });

                const sides = panelsFor(
                    panel('he', stop.name),
                    state.secondaryName ? panel(secondaryLang, state.secondaryName) : null);

                return produceHead(sides, `ראש-תחנה-${stop.code}.pdf`);
            }));

            cell.appendChild(button);
        });
    }

    function appendStripRow(flag, state, strip, problems) {
        const { secondaryLang } = state;

        appendCell(flag, 'tp505-num', cell => {
            for (const routeNum of strip.routes) {
                cell.appendChild(create('span', null, routeNum));
            }
        });

        appendTextCell(flag, 'tp505-text', 'he', strip.hebrew.dest, strip.hebrew.subDest);
        appendTextCell(flag, 'tp505-text', secondaryLang, strip.secondary.dest, strip.secondary.subDest);

        appendCell(flag, 'tp505-act', cell => {
            const button = create('button', 'btn btn-sm btn-dark', TEXT.produceRow);
            button.type = 'button';

            const note = create('div', 'tp505-note');

            button.addEventListener('click', () => run(button, problems, async () => {
                const panel = (lang, text) => ({
                    lang,
                    destType: 'reg',
                    dest: text.dest ?? '',
                    subDest: text.subDest ?? '',
                    routes: strip.routes,
                });

                // The destination is what decides, not the sub-destination: the captions carry
                // their own translations, so a seasonal line with an untranslated destination
                // would otherwise print a second panel saying "Seasonal" over nothing.
                const sides = panelsFor(
                    panel('he', strip.hebrew),
                    strip.secondary.dest ? panel(secondaryLang, strip.secondary) : null);

                try {
                    const rowSpan = await produceStrip(
                        sides,
                        `שורה-${state.stop.code ?? ''}-${strip.routes.join('-')}.pdf`,
                        span => (note.textContent = TEXT.trying(span)));

                    note.textContent = TEXT.rowSpan(rowSpan);
                } catch (error) {
                    // The note is left mid-sentence on the height that failed last; the alert
                    // the caller raises is what says what happened
                    note.textContent = '';

                    throw error;
                }
            }));

            cell.append(button, note);
        });
    }

    /** One button, one job at a time, and whatever went wrong said out loud. */
    async function run(button, problems, job) {
        const label = button.textContent;

        problems.textContent = '';
        button.disabled = true;
        button.textContent = TEXT.producing;

        try {
            await job();
        } catch (error) {
            problems.appendChild(alertBox('danger', `${TEXT.produceFailed}: ${error.message}`));
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    }

    // ------------------------------------------------------------------ entry

    mount();
})();

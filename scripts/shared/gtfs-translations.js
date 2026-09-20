/*
 * Reading a GTFS translation - a stop name or a destination in English or Arabic - for any
 * script that needs one.
 *
 * There is no endpoint that answers "translate this". What the application offers is the GTFS
 * explorer's table endpoint, a DataTables server-side source over whichever GTFS table the
 * address names, and that is what is asked here. It is asked the way the explorer's own grid
 * asks it - form encoded, with DataTables' bracket parameter names - because that is the wire
 * format its [FromForm] binder was built for. Nothing is written back.
 *
 * Two properties of that endpoint shape this file:
 *
 * A text column filters by Contains, not by equality (DbSetProcessor.GetFilterExpression). So
 * the key goes out as a substring and the exact row is picked out here, forgiving what the
 * server forgives when it matches rows back in memory: trailing spaces and case
 * (TranslationKeyComparer). Without that step "רכבת מרכז" would happily answer with the
 * translation of "רכבת מרכז השרון".
 *
 * And because it is a substring, a short key can match far more rows than one page holds, so
 * the pages are walked until the exact row turns up. The order has to be sent with them: the
 * endpoint pages with Skip, and rows walked in an undefined order can repeat one page and
 * skip another.
 */

const TP_TRANSLATIONS_URL = '/GtfsExplorer/Translations/TableDate';

// Enough that the walk almost always ends on the first page, small enough to stay cheap.
const TP_TRANSLATIONS_PAGE_SIZE = 200;

// A key whose substring matches run past this is not a key anyone typed by mistake - it is a
// word. Stopping is better than walking a table of hundreds of thousands of rows.
const TP_TRANSLATIONS_MAX_PAGES = 10;

const TP_TRANSLATIONS_LOG = '[TransPoster]';

/** The columns of the Translations table, in the order the request declares them. */
const TP_TRANSLATION_COLUMNS = ['Key', 'Lang', 'Value'];

/**
 * How a translation key compares once it is out of the database, mirroring
 * TranslationKeyComparer on the server: the feed ships names carrying a stray space their
 * translation key lacks, and an exact === drops rows the database did find.
 */
function tpSameTranslationKey(one, other) {
    return (one ?? '').trim().toLowerCase() === (other ?? '').trim().toLowerCase();
}

/** One page of the Translations table, filtered by a key substring and an exact language. */
async function tpQueryTranslations(keyPart, lang, start) {
    const params = new URLSearchParams();

    params.set('draw', '1');
    params.set('start', String(start));
    params.set('length', String(TP_TRANSLATIONS_PAGE_SIZE));

    const filters = { Key: keyPart, Lang: lang, Value: '' };

    TP_TRANSLATION_COLUMNS.forEach((name, index) => {
        params.set(`columns[${index}][data]`, name);
        params.set(`columns[${index}][name]`, name);
        params.set(`columns[${index}][searchable]`, 'true');
        params.set(`columns[${index}][orderable]`, 'true');
        params.set(`columns[${index}][search][value]`, filters[name]);
        params.set(`columns[${index}][search][regex]`, 'false');
    });

    // By key, so that walking the pages sees every row once
    params.set('order[0][column]', '0');
    params.set('order[0][dir]', 'asc');

    const response = await fetch(TP_TRANSLATIONS_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json',
        },
        body: params.toString(),
    });

    if (!response.ok) {
        throw new Error(`${TP_TRANSLATIONS_URL} → ${response.status}`);
    }

    const payload = await response.json();

    // PascalCase rows inside a camelCase envelope: the endpoint serializes with
    // PropertyNamingPolicy = null, while DataTableResponse names its own fields explicitly
    return {
        rows: payload.data ?? [],
        total: payload.recordsFiltered ?? 0,
    };
}

/**
 * The translation of one key, or null when the table holds none.
 *
 * @param {string} key the name as GTFS spells it in Hebrew - a stop name, or one
 *     underscore-separated part of a headsign, which is what the destination fields hold
 * @param {"he" | "en" | "ar" | "HE" | "EN" | "AR"} lang
 * @returns {Promise<string | null>}
 */
async function tpFindTranslation(key, lang) {
    const wanted = (key ?? '').trim();
    const wantedLang = (lang ?? '').trim().toUpperCase();

    if (!wanted || !wantedLang) {
        return null;
    }

    for (let page = 0; page < TP_TRANSLATIONS_MAX_PAGES; page++) {
        const start = page * TP_TRANSLATIONS_PAGE_SIZE;

        const { rows, total } = await tpQueryTranslations(wanted, wantedLang, start);

        const match = rows.find(row =>
            tpSameTranslationKey(row.Key, wanted) && tpSameTranslationKey(row.Lang, wantedLang)
        );

        if (match) {
            return match.Value ?? null;
        }

        if (!rows.length || start + rows.length >= total) {
            return null;
        }
    }

    // Said out loud rather than returned as "no translation": the two are not the same thing,
    // and a silent "not found" here would be a lie told to whoever typed a very common word
    console.warn(
        TP_TRANSLATIONS_LOG,
        `"${wanted}": יותר מדי התאמות חלקיות, הפסקתי לחפש את ההתאמה המדויקת`
    );

    return null;
}

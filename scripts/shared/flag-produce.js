/*
 * Printing a flag part, for any script that needs one.
 *
 * The endpoint is the one the flag builder's own page posts to, and it is asked for exactly
 * what that page asks for: a type, and the part's language panels as a JSON string.
 *
 * How tall a strip has to be is NOT worked out here, and must not be worked out in the
 * browser. Measuring it the way the builder's preview does disagrees with the produce
 * service - a strip the preview called a fit came back 500. So the service is asked instead:
 * the strip is produced at one row, and on failure again a row taller. The first height that
 * answers with a PDF is the one printed.
 *
 * Nothing is written back to the application: a production reads, renders and returns a file.
 */

const TP_FLAG_PRODUCE_URL = '/flag-builder/produce';

// A strip is one row high unless its route numbers do not fit. A flag is 8 rows tall, so a
// strip the service still refuses at 8 cannot be printed at all.
const TP_FLAG_MAX_ROW_SPAN = 8;

/** What a failed production says. The wording is the mechanism's, so every caller says it alike. */
const TpFlagProduceText = {
    notAllowed: 'נראה שאין לך הרשאה לבנאי הדגל, ובלעדיה אי אפשר להפיק.',
    serverError: status => `שירות ההפקה החזיר שגיאה ${status}.`,
    noFit: status => `ניסיתי להפיק בכל הגבהים מ-1 עד ${TP_FLAG_MAX_ROW_SPAN} וכולם נכשלו (שגיאה אחרונה: ${status}).`
        + ' ייתכן שהסטריפ לא נכנס גם בגובה מלא, או ששירות ההפקה אינו זמין.',
};

/**
 * One production attempt. A PDF is the only success. A refusal and a sign-in page answered as
 * HTML - which is what a user without the flag-builder permission gets - are dead ends;
 * anything else is a failure the caller may retry one row taller.
 *
 * @returns {Promise<{blob?: Blob, fatal?: string, status?: number}>}
 */
async function tpAttemptProduce(type, payload) {
    const response = await fetch(TP_FLAG_PRODUCE_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/pdf' },
        body: JSON.stringify({ type, data: JSON.stringify(payload) }),
    });

    if (response.status === 401 || response.status === 403) {
        return { fatal: TpFlagProduceText.notAllowed };
    }

    if (!response.ok) {
        return { status: response.status };
    }

    if (!(response.headers.get('content-type') ?? '').includes('pdf')) {
        return { fatal: TpFlagProduceText.notAllowed };
    }

    return { blob: await response.blob() };
}

/** Hands the viewer a file to save. */
function tpDownloadFile(blob, fileName) {
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
}

/**
 * Prints a strip, at the height the service accepts it at - see the note at the top of this
 * file for why that height is asked for rather than measured.
 *
 * Each attempt is reported as it starts, so a strip that takes several rounds shows what it is
 * doing instead of sitting silent.
 *
 * @param {{lang: string, destType: string, dest: string, subDest: string, routes: string[]}[]} sides
 *     the language panels, without a rowSpan - this adds it
 * @param {string} fileName
 * @param {(rowSpan: number) => void} onAttempt
 * @returns {Promise<number>} the height it was printed at
 */
async function tpProduceStrip(sides, fileName, onAttempt) {
    let lastStatus = null;

    for (let rowSpan = 1; rowSpan <= TP_FLAG_MAX_ROW_SPAN; rowSpan++) {
        onAttempt(rowSpan);

        const result = await tpAttemptProduce('row', sides.map(side => ({ ...side, rowSpan })));

        if (result.fatal) {
            throw new Error(result.fatal);
        }

        if (result.blob) {
            tpDownloadFile(result.blob, fileName);

            return rowSpan;
        }

        lastStatus = result.status;
    }

    throw new Error(TpFlagProduceText.noFit(lastStatus));
}

/** The head is one row tall by definition, so it is produced once or not at all. */
async function tpProduceHead(sides, fileName) {
    const result = await tpAttemptProduce('header', sides);

    if (!result.blob) {
        throw new Error(result.fatal ?? TpFlagProduceText.serverError(result.status));
    }

    tpDownloadFile(result.blob, fileName);
}

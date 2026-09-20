/*
 * The fixed wording a flag prints, in the three languages flags are printed in.
 *
 * Mirrors FlagCaptions on the server and flag_keywords in the builder's render-preview.js.
 * It lives here rather than being read off whichever page happens to be open, so that a
 * script needing the wording does not depend on the flag builder having loaded on that page.
 *
 * Under the guidelines in force a special destination mode is wording, not a graphic: it is
 * written into the destination line itself. Which line each caption lands on is a rule of the
 * builder, not of the wording, so it is not encoded here - "drop only" and "limited
 * frequency" replace the destination, while "seasonal" replaces the sub-destination only.
 */

const TpFlagKeywords = {
    he: {
        stop: 'תחנה',
        platform: 'רציף',
        dropOnly: 'הורדה בלבד',
        limitedFrequency: 'תדירות מוגבלת',
        seasonal: 'עונתי',
    },
    en: {
        stop: 'Station',
        platform: 'Platform',
        dropOnly: 'Alighting Only',
        limitedFrequency: 'Limited Frequency',
        seasonal: 'Seasonal',
    },
    ar: {
        stop: 'محطة',
        platform: 'منصة',
        dropOnly: 'للتنزيل فقط',
        limitedFrequency: 'تردد محدود',
        seasonal: 'موسمي',
    },
};

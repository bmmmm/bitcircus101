/**
 * validate.mjs — value predicates shared by everything in this repo that
 * validates hand-written JSON: the funding board's data layer
 * (scripts/finanz-data.mjs) and the job board's gate (scripts/check-jobs.mjs).
 * Two unrelated domains, which is the reason these live in neither.
 *
 * They started in finanz-core.js, because the funding board needed them first.
 * check-jobs.mjs then had to reach for them through
 * `createRequire("../finanz-core.js")`, an import that reads as if the job
 * board were part of the funding feature — it is not (#48).
 *
 * Plain ESM, no UMD wrapper: every consumer is Node. The browser renderer
 * never called either predicate, so the wrapper finanz-core.js needs for its
 * own sake bought nothing here.
 *
 * Pure, no I/O. Both express what a JSON Schema `pattern` cannot: that a date
 * exists, and that a URL has a host and no whitespace.
 */

/**
 * Calendar-validate a YYYY-MM-DD string: well-formed AND a date that actually
 * exists, so "2026-13-99" and "2026-02-30" are rejected. Date.UTC is a pure,
 * clock-free construction — deterministic, no wall-clock read.
 */
export function isCalendarDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const y = +s.slice(0, 4);
    const m = +s.slice(5, 7);
    const d = +s.slice(8, 10);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * A usable https link: the "https://" prefix, an actual host after it, and no
 * embedded whitespace — the part of format:"uri" that a `^https://` pattern
 * cannot catch (a bare "https://" and "https://a b c" both satisfy it).
 */
export function isCleanHttpsUrl(s) {
    return (
        typeof s === "string" &&
        s.indexOf("https://") === 0 &&
        s.length > "https://".length &&
        !/\s/.test(s)
    );
}

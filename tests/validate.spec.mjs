/**
 * Unit tests for scripts/validate.mjs — the field predicates shared by the
 * funding board's data layer and the job board's gate. Runs with:
 *   node --test tests/validate.spec.mjs
 *
 * Moved here from tests/finanz-core.spec.mjs together with the predicates
 * themselves (#48). Both are pure, so every case is a single call.
 *
 * The last test is the reason this file matters more than a tidier import: it
 * asserts both boards see the SAME function object, so a rule loosened for one
 * cannot quietly stay strict for the other.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isCalendarDate, isCleanHttpsUrl } from "../scripts/validate.mjs";
import * as FinanzData from "../scripts/finanz-data.mjs";
import * as CheckJobs from "../scripts/check-jobs.mjs";

describe("isCalendarDate", () => {
    it("accepts real dates including a leap day", () => {
        assert.equal(isCalendarDate("2026-06-22"), true);
        assert.equal(isCalendarDate("2024-02-29"), true);
    });
    it("rejects impossible or malformed dates", () => {
        assert.equal(isCalendarDate("2026-13-99"), false);
        assert.equal(isCalendarDate("2026-02-30"), false);
        assert.equal(isCalendarDate("2023-02-29"), false); // 2023 is not a leap year
        assert.equal(isCalendarDate("22.06.2026"), false);
        assert.equal(isCalendarDate(""), false);
        assert.equal(isCalendarDate(null), false);
    });
});

describe("isCleanHttpsUrl", () => {
    it("accepts a normal https URL", () => {
        assert.equal(isCleanHttpsUrl("https://ko-fi.com/bitcircus"), true);
    });
    it("rejects a bare scheme, whitespace, non-https and non-strings", () => {
        assert.equal(isCleanHttpsUrl("https://"), false);
        assert.equal(isCleanHttpsUrl("https://a b c"), false);
        assert.equal(isCleanHttpsUrl("http://ko-fi.com"), false);
        assert.equal(isCleanHttpsUrl(""), false);
        assert.equal(isCleanHttpsUrl(null), false);
    });
});

describe("one implementation, not two", () => {
    it("the funding CLI re-exports this very function", () => {
        assert.equal(
            FinanzData.isCalendarDate,
            isCalendarDate,
            "finanz-data.mjs re-exports a different isCalendarDate — the two validators can drift"
        );
    });

    it("the job board's gate rejects what the predicate rejects", () => {
        // Reach through the gate rather than at the predicate: this is what
        // proves check-jobs.mjs actually routes through validate.mjs, which a
        // direct call on the import could never show.
        const withUrl = (url) => ({
            postings: [
                { id: "x", company: "c", title: "t", url, from: "2026-01-01", months: 1 },
            ],
            karussell: [],
        });
        const bareScheme = CheckJobs.validate(withUrl("https://"));
        assert.equal(
            bareScheme.ok,
            false,
            'a bare "https://" passed the job board gate — it is not using the shared predicate'
        );
        assert.ok(
            bareScheme.errors.some((e) => e.includes("url")),
            `the gate rejected the posting, but for another reason: ${bareScheme.errors.join("; ")}`
        );
        assert.equal(
            CheckJobs.validate(withUrl("https://example.com")).ok,
            true,
            "a normal https URL was rejected by the job board gate"
        );
    });
});

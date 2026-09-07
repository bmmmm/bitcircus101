/**
 * Unit tests for scripts/validate.mjs — the field predicates shared by the
 * funding board's data layer and the job board's gate. Runs with:
 *   node --test tests/validate.spec.mjs
 *
 * The predicate cases moved here from tests/finanz-core.spec.mjs together with
 * the functions themselves (#48).
 *
 * The second half is the reason this file matters more than a tidier import.
 * Its first version asserted that finanz-data.mjs re-exports the same function
 * object and that check-jobs.mjs rejects a bare "https://" — and a review
 * showed both were theatre: giving check-jobs.mjs two private copies kept the
 * suite fully green, and so did leaving the re-export intact while pointing
 * the CALL SITES at a looser copy. Identity of an export says nothing about
 * what the code actually calls.
 *
 * So the claim is measured the only way it can be: sabotage the shared
 * predicate in a copy of the repo, then run both gates for real. A consumer
 * that kept its own copy stays happy — and that is the failure.
 */
import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCalendarDate, isCleanHttpsUrl } from "../scripts/validate.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

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
    let base;
    let repo;
    const VALIDATE = ["scripts", "validate.mjs"];
    // A board whose only interesting field is the URL, and a funding file the
    // repo already keeps valid — so a failure can only come from the predicate.
    const JOBS_FIXTURE = {
        postings: [
            {
                id: "probe-2026-01",
                company: "Probe GmbH",
                title: "Testanzeige",
                url: "https://example.com/stelle",
                from: "2026-01-01",
                months: 1,
            },
        ],
        karussell: [],
    };

    /** Run a gate in the copied repo; returns { ok, out }. */
    function runGate(argv) {
        try {
            const out = execFileSync("node", argv, {
                cwd: repo,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            });
            return { ok: true, out };
        } catch (err) {
            return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
        }
    }

    const JOBS_GATE = ["scripts/check-jobs.mjs", "probe-jobs.json"];
    const FINANZ_GATE = ["scripts/finanz.mjs", "validate"];

    /**
     * Replace one predicate's body with a constant `false` and hand back a
     * restore function. Anchored on the export signature, and loud if it ever
     * stops matching — a silent no-match would make every assertion below
     * vacuous.
     */
    function sabotage(name) {
        const file = path.join(repo, ...VALIDATE);
        const src = fs.readFileSync(file, "utf8");
        const re = new RegExp(`export function ${name}\\(s\\) \\{`);
        assert.match(src, re, `validate.mjs no longer declares ${name} as expected`);
        fs.writeFileSync(file, src.replace(re, `export function ${name}(s) {\n    return false;`));
        return () => fs.writeFileSync(file, src);
    }

    before(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), "bc101-shared-"));
        repo = path.join(base, "repo");
        const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
            .split("\n")
            .filter((f) => f && !f.startsWith("images/"));
        for (const rel of files) {
            const dest = path.join(repo, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(path.join(ROOT, rel), dest);
        }
        fs.writeFileSync(
            path.join(repo, "probe-jobs.json"),
            JSON.stringify(JOBS_FIXTURE, null, 2)
        );

        // The repo's real finanz.json carries no url1/url2 at all, so the
        // funding CLI's URL rule has nothing to run on and sabotaging
        // isCleanHttpsUrl would go unnoticed for a reason that says nothing
        // about which module it calls. Give the copy one link, so the input
        // set for that half cannot be empty. (Found by this very test failing.)
        const finanzPath = path.join(repo, "finanz.json");
        const finanz = JSON.parse(fs.readFileSync(finanzPath, "utf8"));
        assert.ok(finanz.einmalig?.length, "finanz.json has no einmalig item to hang a URL on");
        finanz.einmalig[0].url1 = "https://example.com/spenden";
        fs.writeFileSync(finanzPath, JSON.stringify(finanz, null, 2));
    });

    after(() => {
        if (base) fs.rmSync(base, { recursive: true, force: true });
    });

    it("both gates pass on the untouched copy", () => {
        // The baseline the two sabotage tests below subtract from: without it,
        // a gate that fails for an unrelated reason would read as proof.
        const jobs = runGate(JOBS_GATE);
        assert.ok(jobs.ok, `the job board gate already fails unsabotaged: ${jobs.out}`);
        const finanz = runGate(FINANZ_GATE);
        assert.ok(finanz.ok, `the funding gate already fails unsabotaged: ${finanz.out}`);
    });

    it("breaking isCleanHttpsUrl in validate.mjs is felt by both boards", () => {
        const restore = sabotage("isCleanHttpsUrl");
        try {
            const jobs = runGate(JOBS_GATE);
            assert.ok(
                !jobs.ok && /url/.test(jobs.out),
                "the job board accepted a URL that the shared predicate now rejects — " +
                    "check-jobs.mjs is not calling validate.mjs, or calls a copy of it"
            );
            const finanz = runGate(FINANZ_GATE);
            assert.ok(
                !finanz.ok,
                "the funding CLI accepted a URL that the shared predicate now rejects — " +
                    "finanz-data.mjs is not calling validate.mjs, or calls a copy of it"
            );
        } finally {
            restore();
        }
    });

    it("breaking isCalendarDate in validate.mjs is felt by both boards", () => {
        const restore = sabotage("isCalendarDate");
        try {
            const jobs = runGate(JOBS_GATE);
            assert.ok(
                !jobs.ok && /from/.test(jobs.out),
                "the job board accepted a date that the shared predicate now rejects — " +
                    "check-jobs.mjs is not calling validate.mjs, or calls a copy of it"
            );
            const finanz = runGate(FINANZ_GATE);
            assert.ok(
                !finanz.ok,
                "the funding CLI accepted a date that the shared predicate now rejects — " +
                    "finanz-data.mjs is not calling validate.mjs, or calls a copy of it"
            );
        } finally {
            restore();
        }
    });

    it("the job board names the URL field, not just any error", () => {
        // Pins the message, so the sabotage tests above cannot be satisfied by
        // a rejection that happens to mention "url" for an unrelated reason.
        const bare = { ...JOBS_FIXTURE, postings: [{ ...JOBS_FIXTURE.postings[0], url: "https://" }] };
        fs.writeFileSync(path.join(repo, "probe-bare.json"), JSON.stringify(bare));
        const r = runGate(["scripts/check-jobs.mjs", "probe-bare.json"]);
        assert.ok(!r.ok, 'a bare "https://" passed the job board gate');
        assert.match(
            r.out,
            /postings\[0\]\.url: keine gültige URL/,
            `expected the gate to name the field and the reason, got: ${r.out}`
        );
    });
});

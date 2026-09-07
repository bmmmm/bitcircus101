/**
 * Every script's "am I the main module?" guard must survive a checkout path
 * that needs percent-encoding.
 *
 * The tempting form — `import.meta.url === `file://${process.argv[1]}`` —
 * compares an encoded string against a raw one. On any path holding a space
 * (or #, ?, an umlaut) the two differ, main() never runs, and the script exits
 * 0 having done nothing: a green that measured nothing. It bit check-jobs.mjs
 * (fixed in 5ea454a) and then check-calendars.mjs / sync-events.mjs (#51),
 * which is why this pins the idiom for every script rather than those three.
 *
 * Two tests, because either alone would be weak: the scan catches the idiom
 * coming back in a new script but proves nothing about behaviour, and the run
 * proves behaviour for one script only. The run patches the old form back in
 * and asserts it goes silent — a gate that cannot be shown to fail is not a
 * gate.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: this test of all tests must not itself break
// on a repo path with a space — .pathname would hand back "%20".
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPTS = path.join(ROOT, "scripts");

const HANDBUILT = /`file:\/\/\$\{process\.argv\[1\]\}`/;
const GUARDED = /import\.meta\.url\s*===/;

describe("main-module guard survives a checkout path with a space", () => {
    it("no script builds the guard by hand", () => {
        const scripts = fs.readdirSync(SCRIPTS).filter((n) => n.endsWith(".mjs"));
        const guarded = [];
        const offenders = [];
        for (const name of scripts) {
            const src = fs.readFileSync(path.join(SCRIPTS, name), "utf8");
            if (!GUARDED.test(src)) continue;
            guarded.push(name);
            if (HANDBUILT.test(src)) offenders.push(name);
        }
        // Guard the guard: an empty input set would make this assert vacuously.
        assert.ok(
            guarded.length >= 3,
            `expected several scripts with a main-module guard, found ${guarded.length}`
        );
        assert.deepEqual(
            offenders,
            [],
            `these compare import.meta.url against a hand-built file:// string, ` +
                `so they no-op on a path with a space — use ` +
                `pathToFileURL(process.argv[1]).href: ${offenders.join(", ")}`
        );
    });

    it("check-calendars validates when run from such a path, and would not with the old form", () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), "bc101-guard-"));
        const repo = path.join(base, "repo mit leerzeichen");
        try {
            // The smallest tree check-calendars.mjs needs: its own module, the
            // sibling it imports, the two core modules, and the data it reads.
            // CAL_DIR is cwd-relative, so the copy has to be the cwd of the run.
            fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
            for (const f of ["ics-core.js", "events-core.js"]) {
                fs.copyFileSync(path.join(ROOT, f), path.join(repo, f));
            }
            for (const f of ["check-calendars.mjs", "sync-events.mjs"]) {
                fs.copyFileSync(path.join(SCRIPTS, f), path.join(repo, "scripts", f));
            }
            fs.cpSync(path.join(ROOT, "calendars"), path.join(repo, "calendars"), {
                recursive: true,
            });

            const run = () =>
                execFileSync("node", ["scripts/check-calendars.mjs"], {
                    cwd: repo,
                    encoding: "utf8",
                });

            assert.match(
                run(),
                /calendar source\(s\) valid/,
                "the gate produced no verdict from a path with a space — main() did not run"
            );

            // Now prove the path is what makes the difference: put the old form
            // back and the same run goes silent, exit code 0 and all.
            const target = path.join(repo, "scripts", "check-calendars.mjs");
            const patched = fs
                .readFileSync(target, "utf8")
                .replace(
                    "process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href",
                    "import.meta.url === `file://${process.argv[1]}`"
                );
            assert.ok(
                HANDBUILT.test(patched),
                "could not reinstate the old guard — the anchor in check-calendars.mjs moved"
            );
            fs.writeFileSync(target, patched);

            assert.equal(
                run().trim(),
                "",
                "the old guard was expected to no-op silently here; it did not, " +
                    "so this test no longer proves anything about the fix"
            );
        } finally {
            fs.rmSync(base, { recursive: true, force: true });
        }
    });
});

/**
 * Every script must actually run its main() when started from a checkout path
 * that needs percent-encoding.
 *
 * The tempting guard — `import.meta.url === `file://${process.argv[1]}`` —
 * compares an encoded string against a raw one. On any path holding a space
 * (or #, ?, an umlaut) the two differ, main() never runs, and the script exits
 * 0 having done nothing: a green that measured nothing. It bit check-jobs.mjs
 * (5ea454a) and then check-calendars.mjs / sync-events.mjs (#51).
 *
 * The first version of this file scanned the source for that one spelling. A
 * review broke it seven ways that a reviewer could plausibly write by hand —
 * reversed operands, `==`, string concatenation, the argv value lifted into a
 * variable one line up — each of which kept the defect and stayed green. A
 * blacklist of spellings can only ever list the ones somebody thought of.
 *
 * So this measures behaviour instead. The repo is copied into a directory
 * named "repo mit leerzeichen", every script's main() is replaced by a stub
 * that prints a marker, and each one is run from there. Whatever shape the
 * guard takes, it is evaluated for real against a path with a space — and the
 * repo already carries TWO correct shapes (pathToFileURL(argv).href, and
 * path.resolve(argv) === fileURLToPath(url)), so demanding a spelling would
 * have failed three healthy scripts.
 *
 * The input set is every scripts/**\/*.mjs declaring `function main(` — no
 * count to keep in step, and a script added next month is covered the day it
 * lands.
 */
import { describe, it, before, after } from "node:test";
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
const MARKER = "__MAIN_RAN__";
const MAIN_DECL = /^(export\s+)?(async\s+)?function\s+main\s*\(/m;

/** Every scripts/**\/*.mjs that declares a main() — the set under test. */
function scriptsWithMain() {
    return fs
        .readdirSync(SCRIPTS, { recursive: true })
        .filter((n) => typeof n === "string" && n.endsWith(".mjs"))
        .filter((rel) =>
            MAIN_DECL.test(fs.readFileSync(path.join(SCRIPTS, rel), "utf8"))
        )
        .sort();
}

/**
 * Rename the real main() out of the way and put a marker print in its place,
 * so the guard above it still decides whether to call main — which is the
 * whole question — while nothing expensive, interactive or networked runs.
 *
 * Renaming, not shadowing: a module is strict, so a second `function main`
 * declaration is a SyntaxError rather than an override.
 *
 * Returns a Promise so a guard written as `main().catch(…)` still works.
 */
function stubMain(rel, src) {
    const renamed = src.replace(MAIN_DECL, "$1$2function __realMain(");
    assert.notEqual(renamed, src, `could not stub main() in ${rel} — its declaration moved`);
    return `${renamed}\nfunction main() { console.log(${JSON.stringify(MARKER)}); return Promise.resolve(); }\n`;
}

let base;
let repo;

describe("scripts run their main() from a checkout path with a space", () => {
    before(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), "bc101-guard-"));
        repo = path.join(base, "repo mit leerzeichen");

        // Tracked files only, minus images: the scripts import their siblings
        // and read the repo's real data, so a partial copy would fail for
        // reasons that have nothing to do with the guard.
        const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
            .split("\n")
            .filter((f) => f && !f.startsWith("images/"));
        assert.ok(files.length > 20, `git ls-files returned only ${files.length} paths`);
        for (const rel of files) {
            const dest = path.join(repo, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(path.join(ROOT, rel), dest);
        }
    });

    after(() => {
        if (base) fs.rmSync(base, { recursive: true, force: true });
    });

    it("every script with a main() reaches it", () => {
        const scripts = scriptsWithMain();
        // Guard the guard: an empty set would make the loop below pass while
        // measuring nothing at all.
        assert.ok(
            scripts.length > 0,
            "no script under scripts/ declares a main() — either the convention " +
                "changed or this test stopped finding them; it now proves nothing"
        );

        const silent = [];
        for (const rel of scripts) {
            const target = path.join(repo, "scripts", rel);
            fs.writeFileSync(target, stubMain(rel, fs.readFileSync(path.join(SCRIPTS, rel), "utf8")));
            const out = execFileSync("node", [path.join("scripts", rel)], {
                cwd: repo,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            });
            if (!out.includes(MARKER)) silent.push(rel);
        }

        assert.deepEqual(
            silent,
            [],
            "these scripts did not reach main() when run from a path with a space, " +
                "so they would exit 0 having done nothing: " +
                silent.join(", ")
        );
    });

    it("the measurement can tell the broken guard apart", () => {
        // Without this, the test above would pass just as happily if the stub
        // never ran the guard at all. Take a script that really has one, put
        // the encoding bug back, and require it to go silent.
        // A one-line `if (…) {` naming both halves of the comparison: that is
        // the shape the whole line can be swapped out for the broken one
        // without having to parse the expression inside it.
        const isGuardLine = (l) =>
            /^if \(.*\) \{$/.test(l.trim()) &&
            l.includes("import.meta.url") &&
            l.includes("process.argv");

        const guarded = scriptsWithMain().find((rel) =>
            fs.readFileSync(path.join(SCRIPTS, rel), "utf8").split("\n").some(isGuardLine)
        );
        assert.ok(
            guarded,
            "no script guards main() with a single-line comparison of " +
                "import.meta.url against process.argv any more — if such guards are " +
                "gone, delete this test; if they are merely written differently, " +
                "this red-probe no longer proves anything and must be re-aimed"
        );

        const src = fs.readFileSync(path.join(SCRIPTS, guarded), "utf8");
        const broken = src
            .split("\n")
            .map((l) =>
                isGuardLine(l) ? "if (import.meta.url === `file://${process.argv[1]}`) {" : l
            )
            .join("\n");
        assert.notEqual(broken, src, `could not reinstate the old guard in ${guarded}`);

        fs.writeFileSync(path.join(repo, "scripts", guarded), stubMain(guarded, broken));
        const out = execFileSync("node", [path.join("scripts", guarded)], {
            cwd: repo,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });
        assert.ok(
            !out.includes(MARKER),
            `${guarded} still reached main() with the encoding bug reinstated — ` +
                "this measurement cannot see the defect it exists to catch"
        );
    });
});

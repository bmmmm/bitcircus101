/**
 * Unit tests for scripts/finanz.mjs — the "Finanz-Steuerzentrale" CLI itself.
 * Runs with:
 *   node --test tests/finanz-cli.spec.mjs
 *
 * Two kinds of test, because the two things worth pinning cannot be checked the
 * same way:
 *
 *  • SPAWN tests for exit codes and headless behaviour. An exit code cannot be
 *    observed through an import, and the whole point of the TTY guard is what
 *    happens when stdin is NOT a terminal — `stdio: ["ignore", …]` reproduces
 *    exactly the agent/CI condition that used to yield a silent no-op with
 *    exit 0. These are read-only or abort-only calls on purpose: the CLI writes
 *    to the repo's real finanz.json, so a writing spawn test would edit live
 *    funding data. A guard test asserts the file's bytes are untouched.
 *
 *  • PURE tests for boardJson(), imported directly — which is only possible
 *    because the file now carries a direct-invocation guard instead of calling
 *    main() at import time.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const CLI = new URL("../scripts/finanz.mjs", import.meta.url).pathname;
const FINANZ = new URL("../finanz.json", import.meta.url).pathname;

/** Run the CLI headless: no TTY on stdin, exactly like a script or an agent. */
function run(...args) {
  const res = spawnSync("node", [CLI, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe("finanz CLI — help", () => {
  for (const flag of ["--help", "-h", "help"]) {
    it(`${flag} prints usage on stdout and exits 0`, () => {
      const res = run(flag);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /Finanz-Steuerzentrale/);
      assert.match(res.stdout, /Befehle:/);
      // Help is not an error — nothing on stderr.
      assert.equal(res.stderr, "");
    });
  }

  it("an unknown command still fails with usage on stderr", () => {
    const res = run("definitely-not-a-command");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Unbekannter Befehl/);
    assert.match(res.stderr, /Befehle:/);
  });
});

describe("finanz CLI — headless interactive commands abort instead of no-op'ing", () => {
  // The regression this locks down: each of these printed its first prompt, got
  // EOF, wrote nothing, and exited 0. A caller reading the exit code reported
  // success for work that never happened.
  for (const [label, args] of [
    ["add", ["add"]],
    ["monthly", ["monthly"]],
    ["the bare menu", []],
  ]) {
    it(`${label} exits 1 and writes nothing without a TTY`, () => {
      const before = fs.readFileSync(FINANZ, "utf8");
      const res = run(...args);
      assert.equal(res.status, 1, `${label} must exit 1, got ${res.status}`);
      assert.match(res.stderr, /kein TTY|braucht ein Terminal/);
      // The message must name a way out, not just the problem.
      assert.match(res.stderr, /finanz\.json direkt editieren|--help/);
      assert.equal(fs.readFileSync(FINANZ, "utf8"), before);
    });
  }
});

describe("finanz CLI — --json", () => {
  it("list --json emits parseable JSON and nothing else", () => {
    const res = run("list", "--json");
    assert.equal(res.status, 0);
    const board = JSON.parse(res.stdout); // throws if any prose leaked out
    assert.equal(typeof board.currency, "string");
    assert.ok(Array.isArray(board.einmalig));
    assert.ok(Array.isArray(board.monatlich));
    // No box drawing, no ASCII bar.
    assert.doesNotMatch(res.stdout, /[│┌└├█░]/);
  });

  it("validate --json emits {ok, errors} and exits 0 on a valid file", () => {
    const res = run("validate", "--json");
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out, { ok: true, errors: [] });
  });
});

// ── boardJson: pure, imported directly ───────────────────────────────────────

const { boardJson } = await import("../scripts/finanz.mjs");

const BOARD = {
  currency: "EUR",
  updated: "2026-06-19",
  einmalig: [
    {
      id: "solar-speicher",
      title: "Solarzellen + Speicher",
      tagline: "Solarstrom fürs ganze Jahr",
      description: "lang",
      icon: "☀",
      target: 2000,
      raised: 250,
    },
  ],
  monatlich: [{ id: "glasfaser", title: "Schnelleres Internet", monthly: 30 }],
};

describe("boardJson", () => {
  it("shapes the board with the keys a consumer can rely on", () => {
    const out = boardJson(BOARD, { percent: 18 });
    assert.deepEqual(Object.keys(out), [
      "currency",
      "updated",
      "percent",
      "einmalig",
      "monatlich",
      "pulse",
    ]);
    assert.equal(out.currency, "EUR");
    assert.equal(out.updated, "2026-06-19");
    assert.equal(out.percent, 18);
  });

  it("takes derived values from Core, not from its own arithmetic", () => {
    const p = boardJson(BOARD, {}).einmalig[0];
    // 250/2000 = 12.5 %, which Core rounds to 13. A CLI that computed this
    // itself would most likely truncate to 12 and drift from support.html.
    assert.equal(p.pct, 13);
    assert.equal(p.remaining, 1750);
    assert.equal(p.reached, false);
    assert.equal(p.target, 2000);
    assert.equal(p.raised, 250);
  });

  it("marks a reached project and clamps its remaining at 0", () => {
    const done = boardJson(
      { einmalig: [{ id: "x", title: "X", target: 100, raised: 150 }] },
      null
    ).einmalig[0];
    assert.equal(done.reached, true);
    assert.equal(done.pct, 100);
    assert.equal(done.remaining, 0);
  });

  it("keeps set optional fields and drops unset ones, like finanz.json itself", () => {
    const p = boardJson(BOARD, {}).einmalig[0];
    assert.equal(p.tagline, "Solarstrom fürs ganze Jahr");
    assert.equal(p.icon, "☀");
    // description is deliberately not part of the board payload
    assert.equal("description" in p, false);
    // An item without them carries no empty keys at all.
    const bare = boardJson(
      { einmalig: [{ id: "x", title: "X", target: 10, raised: 0 }] },
      {}
    ).einmalig[0];
    assert.equal("tagline" in bare, false);
    assert.equal("icon" in bare, false);
    const m = boardJson(BOARD, {}).monatlich[0];
    assert.equal("tagline" in m, false);
    assert.equal(m.monthly, 30);
  });

  it("emits a stable pulse shape on a file that has no pulse key", () => {
    assert.deepEqual(boardJson(BOARD, {}).pulse, { updated: null, levels: [] });
  });

  it("passes an existing pulse track through unchanged", () => {
    const withPulse = boardJson(
      { ...BOARD, pulse: { updated: "2026-07-01", levels: [1, 4, 7] } },
      {}
    );
    assert.deepEqual(withPulse.pulse, {
      updated: "2026-07-01",
      levels: [1, 4, 7],
    });
  });

  it("survives an empty board and a missing funding.json", () => {
    const out = boardJson({}, null);
    assert.deepEqual(out.einmalig, []);
    assert.deepEqual(out.monatlich, []);
    assert.equal(out.percent, null);
    assert.equal(out.updated, null);
    assert.equal(out.currency, "EUR");
  });

  it("reports percent 0 as 0, not as null", () => {
    // A funding.json at 0 % is meaningful; only a missing value is null.
    assert.equal(boardJson(BOARD, { percent: 0 }).percent, 0);
  });
});

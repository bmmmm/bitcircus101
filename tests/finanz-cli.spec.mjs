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

describe("finanz CLI — amounts are whole euros", () => {
  // The schema types target/raised/monthly as integers. A decimal used to parse
  // fine and die two layers later, reported as the resulting SUM ("ist 2012.5")
  // — a number the caller never typed. It is now refused at the argument.
  it("raise refuses a decimal and names what was typed, not the sum", () => {
    const before = fs.readFileSync(FINANZ, "utf8");
    const res = run("raise", "solar-speicher", "12,50");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /"12,50"/);
    assert.match(res.stderr, /Nachkommastellen|ganze Euro/);
    // The confusing derived figure must not be what the user is shown.
    assert.doesNotMatch(res.stderr, /2012\.5/);
    assert.equal(fs.readFileSync(FINANZ, "utf8"), before);
  });

  it("the usage text no longer advertises decimals for amounts", () => {
    const res = run("--help");
    assert.equal(res.status, 0);
    assert.doesNotMatch(res.stdout, /Komma oder Punkt erlaubt/);
    assert.match(res.stdout, /ganze Euro/);
  });
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

// ── askNumber: the retry loop behind every interactive amount ────────────────

const { askNumber } = await import("../scripts/finanz.mjs");

/** A readline stand-in: hands out scripted answers, records what was asked. */
function fakeRl(answers) {
  const asked = [];
  return {
    asked,
    left: () => answers.length,
    question: async (q) => {
      asked.push(q);
      if (!answers.length) throw new Error("askNumber asked once too often");
      return answers.shift();
    },
  };
}

/** Run fn with console.log captured, so a re-ask hint can be asserted on. */
async function captureLog(fn) {
  const lines = [];
  const real = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    return { value: await fn(), lines };
  } finally {
    console.log = real;
  }
}

describe("askNumber", () => {
  it("accepts a plain integer", async () => {
    const { value } = await captureLog(() => askNumber(fakeRl(["100"]), "x"));
    assert.equal(value, 100);
  });

  it("re-asks on a decimal when integer is set, then takes the correction", async () => {
    const rl = fakeRl(["12,50", "13"]);
    const { value, lines } = await captureLog(() =>
      askNumber(rl, "Betrag", { integer: true })
    );
    assert.equal(value, 13);
    assert.equal(rl.asked.length, 2, "must ask again, not give up");
    assert.ok(
      lines.some((l) => l.includes("12,50") && /ganze Zahlen/.test(l)),
      `hint must name the input, got: ${JSON.stringify(lines)}`
    );
  });

  it("accepts a decimal when integer is NOT set", async () => {
    const { value } = await captureLog(() => askNumber(fakeRl(["12,50"]), "x"));
    assert.equal(value, 12.5);
  });

  it("accepts a trailing ,00 as a whole euro amount", async () => {
    const { value } = await captureLog(() =>
      askNumber(fakeRl(["100,00"]), "x", { integer: true })
    );
    assert.equal(value, 100);
  });

  it("keeps negative whole amounts, which raise needs", async () => {
    const { value } = await captureLog(() =>
      askNumber(fakeRl(["-50"]), "x", { integer: true })
    );
    assert.equal(value, -50);
  });

  it("re-asks below min and above max instead of returning a bad value", async () => {
    const lo = fakeRl(["0", "1"]);
    const a = await captureLog(() => askNumber(lo, "x", { min: 1, integer: true }));
    assert.equal(a.value, 1);
    assert.equal(lo.asked.length, 2);

    const hi = fakeRl(["8", "7"]);
    const b = await captureLog(() =>
      askNumber(hi, "x", { min: 0, max: 7, integer: true })
    );
    assert.equal(b.value, 7);
    assert.equal(hi.asked.length, 2);
  });

  it("re-asks on garbage, hex and exponent forms", async () => {
    for (const bad of ["abc", "0x10", "1e3"]) {
      const rl = fakeRl([bad, "5"]);
      const { value } = await captureLog(() => askNumber(rl, "x", { integer: true }));
      assert.equal(value, 5, `${bad} must be rejected`);
      assert.equal(rl.asked.length, 2);
    }
  });

  it("returns the fallback on a bare Enter, but re-asks when there is none", async () => {
    const withFb = await captureLog(() =>
      askNumber(fakeRl([""]), "x", { fallback: 0, integer: true })
    );
    assert.equal(withFb.value, 0);

    const rl = fakeRl(["", "7"]);
    const without = await captureLog(() => askNumber(rl, "x", { integer: true }));
    assert.equal(without.value, 7);
    assert.equal(rl.asked.length, 2, "a bare Enter must never coerce to 0");
  });
});

// ── The interactive call sites, driven by a scripted rl (no terminal) ────────

const { interactiveAddEinmalig, interactiveMenu, interactiveMonthly } =
  await import("../scripts/finanz.mjs");

describe("interactive amount prompts enforce whole euros at the call site", () => {
  // Every flow below answers "n" at the confirm, so finanz.json is never
  // written; the assertion is on WHAT WAS ASKED, which is what pins the
  // options the call sites pass.
  it("add re-asks a decimal target and a target of 0, then accepts 1", async () => {
    const before = fs.readFileSync(FINANZ, "utf8");
    const rl = fakeRl([
      "test-id",
      "Titel",
      "",
      "",
      "",
      "12,50", // decimal target → re-ask
      "0", // below the minimum of 1 → re-ask
      "1", // accepted
      "0", // raised
      "",
      "",
      "n", // do not save
    ]);
    const { lines } = await captureLog(() =>
      interactiveAddEinmalig("2026-09-01", rl)
    );
    const targetAsks = rl.asked.filter((q) => q.includes("Zielbetrag"));
    assert.equal(targetAsks.length, 3, "must re-ask twice before accepting");
    assert.ok(
      lines.some((l) => /"12,50".*ganze Euro.*13/.test(l)),
      `money prompts keep the euro wording and suggest 13, got: ${JSON.stringify(
        lines
      )}`
    );
    assert.ok(
      lines.some((l) => /mindestens 1/.test(l)),
      `minimum must be 1 euro, got: ${JSON.stringify(lines)}`
    );
    assert.ok(lines.some((l) => l.includes("Abgebrochen")));
    assert.equal(fs.readFileSync(FINANZ, "utf8"), before);
  });

  it("monthly re-asks a decimal amount and a 0, then accepts 1", async () => {
    const before = fs.readFileSync(FINANZ, "utf8");
    const rl = fakeRl([
      "1", // add
      "test-monthly",
      "Titel",
      "",
      "",
      "",
      "29,99", // decimal → re-ask
      "0", // below minimum → re-ask
      "1",
      "",
      "",
      "n",
    ]);
    const { lines } = await captureLog(() =>
      interactiveMonthly("2026-09-01", rl)
    );
    const asks = rl.asked.filter((q) => q.includes("Betrag pro Monat"));
    assert.equal(asks.length, 3);
    assert.ok(lines.some((l) => l.includes("29,99")));
    assert.ok(lines.some((l) => /mindestens 1/.test(l)));
    assert.equal(fs.readFileSync(FINANZ, "utf8"), before);
  });
});

describe("the menu's own amount prompts", () => {
  // Driven through an injected rl, so the branches are exercised without a
  // terminal. Every case answers "n" at the confirm — nothing is written.
  it("raise (1) re-asks a decimal before confirming", async () => {
    const before = fs.readFileSync(FINANZ, "utf8");
    const rl = fakeRl(["1", "solar-speicher", "12,50", "100", "n"]);
    const { lines } = await captureLog(() => interactiveMenu(rl));
    assert.equal(
      rl.asked.filter((q) => q.includes("Betrag (+/-)")).length,
      2,
      "a decimal must be re-asked, not passed on to the validator"
    );
    assert.ok(lines.some((l) => l.includes("12,50")));
    assert.ok(lines.some((l) => l.includes("Abgebrochen")));
    assert.equal(fs.readFileSync(FINANZ, "utf8"), before);
  });

  it("pulse (5) re-asks 8 and a decimal instead of dropping out of the menu", async () => {
    const before = fs.readFileSync(FINANZ, "utf8");
    const rl = fakeRl(["5", "8", "3,5", "4", "n"]);
    const { lines } = await captureLog(() => interactiveMenu(rl));
    assert.equal(
      rl.asked.filter((q) => q.includes("Puls-Level 0..7")).length,
      3,
      "out-of-range and non-integer levels must both re-ask"
    );
    assert.ok(
      lines.some((l) => /höchstens 7/.test(l)),
      `the upper bound must be 7, got: ${JSON.stringify(lines)}`
    );
    // The pulse is a level, not money. No prompt around it may say "Euro" —
    // the whole point of the track is that it carries no amount.
    const hints = lines.filter((l) => /3,5|höchstens 7/.test(l));
    assert.equal(hints.length, 2, `expected both hints, got: ${JSON.stringify(hints)}`);
    assert.ok(
      hints.every((l) => !/Euro|€/.test(l)),
      `the pulse must never be described in euros, got: ${JSON.stringify(hints)}`
    );
    assert.ok(
      lines.some((l) => /"3,5".*ganze Zahlen/.test(l)),
      `the hint must say "ganze Zahlen" here, got: ${JSON.stringify(lines)}`
    );
    assert.ok(lines.some((l) => l.includes("Abgebrochen")));
    assert.equal(fs.readFileSync(FINANZ, "utf8"), before);
  });

  it("validate (7) is read-only and reports the real file", async () => {
    const before = fs.readFileSync(FINANZ, "utf8");
    const { lines } = await captureLog(() => interactiveMenu(fakeRl(["7"])));
    assert.ok(lines.some((l) => l.includes("finanz.json ist gültig")));
    assert.equal(fs.readFileSync(FINANZ, "utf8"), before);
  });
});

describe("askNumber — the whole-number hint fits its context", () => {
  it("says 'ganze Euro' with a unit and 'ganze Zahlen' without", async () => {
    const money = await captureLog(() =>
      askNumber(fakeRl(["12,50", "13"]), "x", { integer: true, unit: "Euro" })
    );
    assert.ok(money.lines.some((l) => /ganze Euro/.test(l)));

    const level = await captureLog(() =>
      askNumber(fakeRl(["3,5", "4"]), "x", { integer: true })
    );
    assert.ok(level.lines.some((l) => /ganze Zahlen/.test(l)));
    assert.ok(level.lines.every((l) => !/Euro|€/.test(l)));
  });

  it("suggests the rounded value of what was actually typed", async () => {
    const a = await captureLog(() =>
      askNumber(fakeRl(["3,5", "4"]), "x", { integer: true })
    );
    assert.ok(
      a.lines.some((l) => l.includes("4 statt 3,5")),
      `got: ${JSON.stringify(a.lines)}`
    );
    const b = await captureLog(() =>
      askNumber(fakeRl(["12,50", "13"]), "x", { integer: true, unit: "Euro" })
    );
    assert.ok(b.lines.some((l) => l.includes("13 statt 12,50")));
  });
});

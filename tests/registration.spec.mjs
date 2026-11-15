import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { handleRegistration } from "../server/registration.mjs";

const event = {
  id: "bitcircus101-on-rails-2027",
  title: "bitcircus101 on rails",
  startsAt: "2027-01-23T11:00:00+01:00",
  location: "Treffpunkt wird noch bekannt gegeben",
  contact: "info@bitcircus101.de",
  registrationMode: "live",
};
const envWith = (DB) => ({ DB, RESEND_API_KEY: "test-key", REGISTRATION_FROM: "Events <events@example.test>" });
const payload = (overrides = {}) => ({
  eventId: event.id,
  vorname: "Ada",
  nachname: "Lovelace",
  email: "ada@example.test",
  botcheck: "",
  startedAt: Date.now() - 5000,
  ...overrides,
});
const request = (data, method = "POST") => new Request("https://example.test/api/anmelden", {
  method,
  headers: { "Content-Type": "application/json" },
  body: method === "POST" ? JSON.stringify(data) : undefined,
});

function mockDb() {
  const rows = new Map();
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              if (sql.startsWith("INSERT")) {
                const [id, eventId, vorname, nachname, email] = values;
                const key = `${eventId}:${email}`;
                if (!rows.has(key)) rows.set(key, { id, event_id: eventId, vorname, nachname, email, email_sent_at: null });
              } else if (sql.startsWith("UPDATE")) {
                const row = [...rows.values()].find((item) => item.id === values[0]);
                row.email_sent_at = "2026-11-15 12:00:00";
              }
              return { success: true };
            },
            async first() {
              const [eventId, email] = values;
              return rows.get(`${eventId}:${email}`) ?? null;
            },
          };
        },
      };
    },
  };
  return { db, rows };
}

const decode = async (response) => ({ response, body: await response.json() });

describe("registration endpoint", () => {
  it("checks method, preview mode, and required bindings", async () => {
    const { db } = mockDb();
    assert.equal((await handleRegistration(request({}, "GET"), envWith(db), { event })).status, 405);
    assert.equal((await handleRegistration(request(payload()), envWith(db), { event: { ...event, registrationMode: "preview" } })).status, 503);
    assert.equal((await handleRegistration(request(payload()), {}, { event })).status, 503);
  });

  it("rejects malformed, oversized, and invalid field data without calling email", async () => {
    const { db } = mockDb();
    let calls = 0;
    const fetch = async () => { calls++; return new Response(null, { status: 200 }); };
    const invalid = await decode(await handleRegistration(request(payload({ email: "nope", botcheck: "filled" })), envWith(db), { event, fetch }));
    assert.equal(invalid.response.status, 400);
    assert.ok(invalid.body.errors.email);
    assert.ok(invalid.body.errors.botcheck);
    assert.equal(calls, 0);
    const oversized = new Request("https://example.test/api/anmelden", { method: "POST", headers: { "Content-Length": "5000" }, body: "{}" });
    assert.equal((await handleRegistration(oversized, envWith(db), { event })).status, 413);
    assert.equal((await handleRegistration(new Request("https://example.test/api/anmelden", { method: "POST", body: "{" }), envWith(db), { event })).status, 400);
  });

  it("enforces the human timing window", async () => {
    const { db } = mockDb();
    for (const startedAt of [Date.now() - 2999, Date.now() - 86400001, "old"]) {
      const result = await decode(await handleRegistration(request(payload({ startedAt })), envWith(db), { event }));
      assert.equal(result.response.status, 400);
      assert.ok(result.body.errors.startedAt);
    }
  });

  it("stores pending registration, retries a failed email, then sends once", async () => {
    const { db, rows } = mockDb();
    let calls = 0;
    const fetch = async (_url, init) => {
      calls++;
      assert.equal(init.headers["Idempotency-Key"], `registration-${[...rows.values()][0].id}`);
      if (calls === 1) return new Response("failure", { status: 500 });
      assert.match(JSON.parse(init.body).html, /bitcircus101 on rails/);
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    };
    const first = await decode(await handleRegistration(request(payload()), envWith(db), { event, fetch }));
    assert.equal(first.response.status, 502);
    assert.equal(first.body.ok, false);
    assert.equal([...rows.values()][0].email_sent_at, null);

    const retry = await decode(await handleRegistration(request(payload()), envWith(db), { event, fetch }));
    assert.equal(retry.response.status, 200);
    assert.deepEqual(retry.body, { ok: true });
    assert.ok([...rows.values()][0].email_sent_at);
    assert.equal(calls, 2);

    const duplicate = await decode(await handleRegistration(request(payload()), envWith(db), { event, fetch }));
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.error, "Du stehst schon auf der Liste");
    assert.equal(calls, 2);
  });

  it("normalizes email and never echoes submitted personal data", async () => {
    const { db, rows } = mockDb();
    const fetch = async () => new Response("{}", { status: 200 });
    const input = payload({ email: "ADA@EXAMPLE.TEST", vorname: "<Ada>" });
    const response = await handleRegistration(request(input), envWith(db), { event, fetch });
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal([...rows.values()][0].email, "ada@example.test");
  });
});

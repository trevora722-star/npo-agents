import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.mjs";
import { createStore } from "../src/store.mjs";
import { extractJson } from "../src/model.mjs";
import { parseDraftReply } from "../src/drafts.mjs";

// A stand-in model. Newsletter parsing and drafting get different canned replies.
function fakeModel(draft) {
  return async ({ system }) => {
    if (system.includes("newsletter")) {
      return JSON.stringify([
        { name: "Family Walk", date: "2026-11-20", time: "10 AM", format: "In person", location: "Park", sourceQuote: "Nov 20: Family Walk" },
        { name: "Undated item", date: "", time: "", sourceQuote: "" },
      ]);
    }
    return JSON.stringify(draft);
  };
}

const CLEAN_DRAFT = { subject: "Reminder: Family Walk", body: "Join us Nov 20 at 10 AM.", facts_used: [], unverified: [] };
const PLACEHOLDER_DRAFT = { subject: "Reminder: Family Walk", body: "Meet at [VENUE ADDRESS].", facts_used: [], unverified: ["[VENUE ADDRESS]"] };

let server;
let base;
let store;
let draftReply = CLEAN_DRAFT;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "nea-"));
  store = createStore(join(dir, "db.json"));
  const app = createApp({
    store,
    demo: true,
    sessionSecret: "test",
    ask: (args) => fakeModel(draftReply)(args),
    today: () => "2026-10-30",
  });
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function signIn(role) {
  const res = await fetch(`${base}/auth/demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
  return res.headers.get("set-cookie").split(";")[0];
}

const call = (cookie, method, path, body) => fetch(`${base}${path}`, {
  method,
  headers: { "content-type": "application/json", cookie },
  body: body ? JSON.stringify(body) : undefined,
});

async function confirmedEvent(approver, drafter) {
  const ev = await (await call(drafter, "POST", "/api/events", { name: "Family Walk", date: "2026-11-20", time: "10 AM", location: "Park" })).json();
  await call(approver, "POST", `/api/events/${ev.id}/confirm`);
  return ev.id;
}

test("store reads are filtered by organization", async () => {
  await store.insert("events", { orgId: "org-a", name: "A event" });
  await store.insert("events", { orgId: "org-b", name: "B event" });
  const a = await store.list("events", "org-a");
  assert.equal(a.length, 1);
  assert.equal(a[0].name, "A event");
  assert.equal(await store.get("events", "org-a", (await store.list("events", "org-b"))[0].id), null);
});

test("events need a real date; new events start proposed", async () => {
  const drafter = await signIn("drafter");
  const bad = await call(drafter, "POST", "/api/events", { name: "X", date: "2026-02-31" });
  assert.equal(bad.status, 400);
  const ok = await call(drafter, "POST", "/api/events", { name: "X", date: "2026-12-01" });
  assert.equal((await ok.json()).status, "proposed");
});

test("drafts wait for event confirmation; drafters cannot confirm", async () => {
  const drafter = await signIn("drafter");
  const approver = await signIn("approver");
  const ev = await (await call(drafter, "POST", "/api/events", { name: "Pending", date: "2026-12-02" })).json();
  assert.equal((await call(drafter, "POST", "/api/events/" + ev.id + "/confirm")).status, 403);
  draftReply = CLEAN_DRAFT;
  const blocked = await call(drafter, "POST", "/api/drafts", { eventId: ev.id, type: "reminder" });
  assert.equal(blocked.status, 400);
  await call(approver, "POST", `/api/events/${ev.id}/confirm`);
});

test("import proposes events and skips items with no usable date", async () => {
  const drafter = await signIn("drafter");
  const res = await call(drafter, "POST", "/api/events/import", { text: "A newsletter with an events section that is long enough to pass the check." });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.added.length, 1);
  assert.equal(body.skipped, 1);
  assert.equal(body.added[0].status, "proposed");
});

test("a placeholder blocks sending until the approver fills it in", async () => {
  const drafter = await signIn("drafter");
  const approver = await signIn("approver");
  const eventId = await confirmedEvent(approver, drafter);

  draftReply = PLACEHOLDER_DRAFT;
  const draft = await (await call(drafter, "POST", "/api/drafts", { eventId, type: "reminder" })).json();
  const approveRefused = await call(approver, "POST", `/api/drafts/${draft.id}/approve`, { note: "" });
  assert.equal(approveRefused.status, 400);
  assert.match((await approveRefused.json()).error, /Fill in \[VENUE ADDRESS\]/);

  const checked = await (await call(approver, "GET", `/api/drafts/${draft.id}/check`)).json();
  assert.equal(checked.canSend, false);
  assert.deepEqual(checked.placeholders, ["[VENUE ADDRESS]"]);
});

test("a draft cannot be approved while it still has a placeholder, and cannot be edited after approval", async () => {
  const drafter = await signIn("drafter");
  const approver = await signIn("approver");
  const eventId = await confirmedEvent(approver, drafter);
  draftReply = PLACEHOLDER_DRAFT;
  const draft = await (await call(drafter, "POST", "/api/drafts", { eventId, type: "reminder" })).json();
  await call(approver, "PUT", `/api/drafts/${draft.id}`, { subject: "Reminder", body: "Meet at Park, Vancouver." });
  assert.equal((await call(approver, "POST", `/api/drafts/${draft.id}/approve`, { note: "" })).status, 200);
  const reEdit = await call(approver, "PUT", `/api/drafts/${draft.id}`, { subject: "x", body: "y" });
  assert.equal(reEdit.status, 400);
});

test("an approved, filled-in draft sends once after a typed SEND", async () => {
  const drafter = await signIn("drafter");
  const approver = await signIn("approver");
  const eventId = await confirmedEvent(approver, drafter);

  draftReply = PLACEHOLDER_DRAFT;
  const draft = await (await call(drafter, "POST", "/api/drafts", { eventId, type: "reminder" })).json();
  const fixed = await call(approver, "PUT", `/api/drafts/${draft.id}`, { subject: "Reminder", body: "Meet at Park, Vancouver." });
  assert.equal(fixed.status, 200);
  await call(approver, "POST", `/api/drafts/${draft.id}/approve`, { note: "" });

  const noWord = await call(approver, "POST", `/api/drafts/${draft.id}/send`, { audience: "Family members", confirm: "send" });
  assert.equal(noWord.status, 400);

  const sent = await call(approver, "POST", `/api/drafts/${draft.id}/send`, { audience: "Family members", confirm: "SEND" });
  assert.equal(sent.status, 200);
  const body = await sent.json();
  assert.equal(body.status, "sent");
  assert.equal(body.sendResult.simulated, true);
  assert.equal(body.sendResult.recipientCount, 120);

  const again = await call(approver, "POST", `/api/drafts/${draft.id}/send`, { audience: "Family members", confirm: "SEND" });
  assert.equal(again.status, 400);
});

test("drafters cannot send; social posts need a connection and cannot be emailed", async () => {
  const drafter = await signIn("drafter");
  const approver = await signIn("approver");
  const eventId = await confirmedEvent(approver, drafter);

  draftReply = { subject: "Walk on Nov 20", body: "Join us at the park on Nov 20.", facts_used: [], unverified: [] };
  const social = await (await call(drafter, "POST", "/api/drafts", { eventId, type: "social" })).json();
  await call(approver, "POST", `/api/drafts/${social.id}/approve`, { note: "" });

  assert.equal((await call(drafter, "POST", `/api/drafts/${social.id}/send`, { audience: "Family members", confirm: "SEND" })).status, 403);
  assert.equal((await call(approver, "POST", `/api/drafts/${social.id}/send`, { audience: "Family members", confirm: "SEND" })).status, 400);

  const notConnected = await call(approver, "POST", `/api/drafts/${social.id}/post-social`, { channel: "Instagram", confirm: "SEND" });
  assert.equal(notConnected.status, 400);

  await call(approver, "POST", "/api/social/connect", { channel: "Instagram" });
  const posted = await call(approver, "POST", `/api/drafts/${social.id}/post-social`, { channel: "Instagram", confirm: "SEND" });
  assert.equal(posted.status, 200);
  assert.equal((await posted.json()).sendResult.channel, "Instagram");
});

test("an organization on Constant Contact is refused until it is connected", async () => {
  const approver = await signIn("approver");
  const drafter = await signIn("drafter");
  const eventId = await confirmedEvent(approver, drafter);
  draftReply = CLEAN_DRAFT;
  const draft = await (await call(drafter, "POST", "/api/drafts", { eventId, type: "followup" })).json();
  await call(approver, "POST", `/api/drafts/${draft.id}/approve`, { note: "" });

  await store.update("orgs", "demo-org", "demo-org", () => ({ sendingProvider: "constant_contact" }));
  try {
    const audiences = await (await call(approver, "GET", "/api/audiences")).json();
    assert.match(audiences.connectionError, /not connected/);
    const sent = await call(approver, "POST", `/api/drafts/${draft.id}/send`, { audience: "Family members", confirm: "SEND" });
    assert.equal(sent.status, 501);
  } finally {
    await store.update("orgs", "demo-org", "demo-org", () => ({ sendingProvider: "simulated" }));
  }
});

test("the audit log records actions and only approvers can read it", async () => {
  const drafter = await signIn("drafter");
  const approver = await signIn("approver");
  assert.equal((await call(drafter, "GET", "/api/audit")).status, 403);
  const log = await (await call(approver, "GET", "/api/audit")).json();
  const actions = log.map((row) => row.action);
  assert.ok(actions.includes("draft_created"));
  assert.ok(actions.includes("email_sent"));
});

test("the model reply parser refuses incomplete drafts", () => {
  assert.throws(() => parseDraftReply('{"subject":"S"}'), /missing "body"/);
  assert.throws(() => parseDraftReply("no json here"), /no JSON/);
  assert.equal(parseDraftReply('Here: {"subject":"S","body":"B"} thanks').body, "B");
  assert.equal(extractJson('[{"a":1}]', "array")[0].a, 1);
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.mjs";
import { createStore } from "../src/store.mjs";

let server;
let base;
let modelReply = { subject: "Hello", body: "A short draft.", unverified: [] };
const TODAY = "2026-10-30";

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "agents-"));
  const store = createStore(join(dir, "db.json"));
  const app = createApp({ store, demo: true, sessionSecret: "test", ask: async () => JSON.stringify(modelReply), today: () => TODAY });
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function signIn(role) {
  const res = await fetch(`${base}/auth/demo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) });
  return res.headers.get("set-cookie").split(";")[0];
}

const call = (cookie, method, path, body) => fetch(`${base}${path}`, {
  method,
  headers: { "content-type": "application/json", cookie },
  body: body ? JSON.stringify(body) : undefined,
});

const rec = (cookie, agent, type, body) => call(cookie, "POST", `/api/agents/${agent}/records/${type}`, body);

test("the agent catalogue lists every agent with its record forms", async () => {
  const drafter = await signIn("drafter");
  const agents = await (await call(drafter, "GET", "/api/agents")).json();
  const ids = agents.map((a) => a.id);
  for (const id of ["donor-receipts", "grants", "volunteers", "newsletter", "compliance", "governance", "renewals"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  assert.ok(agents.every((a) => Object.keys(a.recordTypes).length > 0));
});

test("grants: a report needs program results before it can be drafted; deadlines show on the calendar", async () => {
  const drafter = await signIn("drafter");
  const funder = await (await rec(drafter, "grants", "funders", { name: "Community Fund", deadline: "2026-11-20", status: "Drafting" })).json();
  const report = await (await rec(drafter, "grants", "reports", { funderId: funder.id, dueDate: "2026-12-01", period: "Jan-Jun", reportStatus: "Not started" })).json();
  const refused = await call(drafter, "POST", "/api/agents/grants/draft", { kind: "grant_report", recordId: report.id });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /program results/);

  const summary = await (await call(drafter, "GET", "/api/agents/grants/summary")).json();
  assert.ok(summary.sections[0].rows.some((r) => r.label.includes("Community Fund")));
  assert.ok(summary.sections[1].rows.some((r) => r.label.includes("Jan-Jun")));
});

test("grants: an invalid status is refused", async () => {
  const drafter = await signIn("drafter");
  const bad = await rec(drafter, "grants", "funders", { name: "X", deadline: "2026-11-20", status: "Maybe" });
  assert.equal(bad.status, 400);
});

test("volunteers: a shift that needs screened volunteers shows the shortfall; welcome emails need consent", async () => {
  const drafter = await signIn("drafter");
  await rec(drafter, "volunteers", "volunteers", { name: "Ari Woods", role: "Youth mentor", screeningStatus: "Submitted", mayContact: true });
  await rec(drafter, "volunteers", "shifts", { title: "Mentor evening", date: "2026-11-14", role: "Youth mentor", volunteersNeeded: 2 });
  const summary = await (await call(drafter, "GET", "/api/agents/volunteers/summary")).json();
  const shift = summary.sections[0].rows.find((r) => r.label.includes("Mentor evening"));
  assert.match(shift.detail, /Needs 2 cleared volunteers; 0 available/);
  const screening = summary.sections[1].rows.map((r) => r.label);
  assert.ok(screening.includes("Ari Woods"));

  const noConsent = await rec(drafter, "volunteers", "volunteers", { name: "Quiet Member", role: "Event helper", screeningStatus: "Not started", mayContact: false });
  const quiet = await noConsent.json();
  const refused = await call(drafter, "POST", "/api/agents/volunteers/draft", { kind: "welcome", recordId: quiet.id });
  assert.equal(refused.status, 400);
});

test("volunteers: a cleared screening needs a date", async () => {
  const drafter = await signIn("drafter");
  const bad = await rec(drafter, "volunteers", "volunteers", { name: "No Date", role: "Driver", screeningStatus: "Cleared" });
  assert.equal(bad.status, 400);
});

test("volunteers: hours must be between 0 and 24 for one day", async () => {
  const drafter = await signIn("drafter");
  const vol = await (await rec(drafter, "volunteers", "volunteers", { name: "Hour Logger", role: "Event helper", screeningStatus: "Not started" })).json();
  assert.equal((await rec(drafter, "volunteers", "hours", { volunteerId: vol.id, date: "2026-10-10", hours: 30 })).status, 400);
  assert.equal((await rec(drafter, "volunteers", "hours", { volunteerId: vol.id, date: "2026-10-10", hours: 3 })).status, 201);
});

test("newsletter: sends go only to consenting subscribers and need an unsubscribe line", async () => {
  const drafter = await signIn("drafter");
  const approver = await signIn("approver");
  await rec(drafter, "newsletter", "subscribers", { email: "yes@example.org", consent: true, consentSource: "web form 2026-03" });
  await rec(drafter, "newsletter", "subscribers", { email: "no@example.org", consent: false });
  const issue = await (await rec(drafter, "newsletter", "issues", { title: "November news", month: "2026-11", updatesIncluded: "Gala date set" })).json();

  // The first issue has no unsubscribe line, so it must not send.
  modelReply = { subject: "November news", body: "Hello friends.", unverified: [] };
  const plain = await (await call(drafter, "POST", "/api/agents/newsletter/draft", { kind: "newsletter", recordId: issue.id })).json();
  assert.equal((await call(approver, "POST", `/api/items/${plain.id}/approve`, { note: "" })).status, 200);
  const noUnsub = await call(approver, "POST", `/api/items/${plain.id}/complete`, { confirm: "SEND" });
  assert.equal(noUnsub.status, 400);
  assert.match((await noUnsub.json()).error, /unsubscribe/);

  // The second draft gets the line while it is pending, then sends to the consenting subscriber only.
  const item = await (await call(drafter, "POST", "/api/agents/newsletter/draft", { kind: "newsletter", recordId: issue.id })).json();
  await call(approver, "PUT", `/api/items/${item.id}`, { subject: "November news", body: "Hello friends.\n\nTo unsubscribe, reply STOP." });
  assert.equal((await call(approver, "POST", `/api/items/${item.id}/approve`, { note: "" })).status, 200);
  const sent = await call(approver, "POST", `/api/items/${item.id}/complete`, { confirm: "SEND" });
  assert.equal(sent.status, 200);
  const done = await sent.json();
  assert.equal(done.result.recipientCount, 1);
  assert.equal(done.result.simulated, true);
});

test("newsletter: subscribers without recorded consent are never counted", async () => {
  const drafter = await signIn("drafter");
  const summary = await (await call(drafter, "GET", "/api/agents/newsletter/summary")).json();
  assert.match(summary.sections[0].rows[0].label, /^\d+ consented subscribers$/);
  assert.ok(summary.sections[1].rows.some((r) => r.label === "no@example.org"));
});

test("compliance: marking a yearly obligation done schedules the next one", async () => {
  const drafter = await signIn("drafter");
  const approver = await signIn("approver");
  const ob = await (await rec(drafter, "compliance", "obligations", { name: "Annual return", dueDate: "2026-11-30", owner: "Finance lead", recurrence: "Yearly", status: "Open" })).json();
  const done = await call(approver, "POST", "/api/agents/compliance/actions/markDone", { recordId: ob.id });
  assert.equal(done.status, 200);
  const next = (await done.json()).record;
  assert.equal(next.dueDate, "2027-11-30");
  assert.equal(next.status, "Open");
  const again = await call(approver, "POST", "/api/agents/compliance/actions/markDone", { recordId: ob.id });
  assert.equal(again.status, 400);
});

test("compliance: a reminder needs an owner email", async () => {
  const drafter = await signIn("drafter");
  const ob = await (await rec(drafter, "compliance", "obligations", { name: "Insurance", dueDate: "2026-12-15", owner: "Office lead", recurrence: "None", status: "Open" })).json();
  const refused = await call(drafter, "POST", "/api/agents/compliance/draft", { kind: "due_reminder", recordId: ob.id });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /email/);
});

test("governance: minutes cannot be marked approved while a motion needs confirming", async () => {
  const drafter = await signIn("drafter");
  const approver = await signIn("approver");
  const meeting = await (await rec(drafter, "governance", "meetings", { title: "Board", date: "2026-10-15", kind: "Board", notes: "Motion to approve budget; vote unclear." })).json();
  modelReply = { subject: "Minutes", body: "DRAFT. Motion to approve budget. [CONFIRM: vote count not recorded]", unverified: [] };
  const item = await (await call(drafter, "POST", "/api/agents/governance/draft", { kind: "minutes", recordId: meeting.id })).json();
  await call(approver, "POST", `/api/items/${item.id}/approve`, { note: "" }).then(() => {});
  const approvedItem = await (await call(approver, "GET", "/api/agents/governance/items")).json();
  const itemNow = approvedItem.find((i) => i.id === item.id);
  assert.equal(itemNow.status, "approved");
  const blocked = await call(approver, "POST", `/api/items/${item.id}/complete`, { confirm: "APPROVED" });
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /CONFIRM/);
});

test("renewals: reminders need consent; lapsed memberships are listed", async () => {
  const drafter = await signIn("drafter");
  const lapsed = await (await rec(drafter, "renewals", "members", { name: "Old Member", membershipType: "Individual", paidUntil: "2026-06-30", mayContact: true, email: "old@example.org" })).json();
  const quiet = await (await rec(drafter, "renewals", "members", { name: "Quiet Member", membershipType: "Family", paidUntil: "2026-12-01", mayContact: false })).json();
  const summary = await (await call(drafter, "GET", "/api/agents/renewals/summary")).json();
  assert.ok(summary.sections[1].rows.some((r) => r.id === lapsed.id));
  assert.equal((await call(drafter, "POST", "/api/agents/renewals/draft", { kind: "renewal_reminder", recordId: quiet.id })).status, 400);
});

test("every agent rejects a record with a missing required field", async () => {
  const drafter = await signIn("drafter");
  const cases = [
    ["grants", "funders", { name: "", deadline: "2026-01-01", status: "Planning" }],
    ["volunteers", "shifts", { title: "", date: "2026-01-01", role: "Event helper", volunteersNeeded: 1 }],
    ["newsletter", "updates", { title: "", facts: "x" }],
    ["compliance", "obligations", { name: "x", dueDate: "2026-01-01", owner: "", recurrence: "None", status: "Open" }],
    ["governance", "meetings", { title: "x", date: "", kind: "Board" }],
    ["renewals", "members", { name: "", membershipType: "Individual" }],
  ];
  for (const [agent, type, body] of cases) {
    assert.equal((await rec(drafter, agent, type, body)).status, 400, `${agent}/${type} should refuse`);
  }
});

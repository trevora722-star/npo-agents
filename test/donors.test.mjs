import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.mjs";
import { createStore } from "../src/store.mjs";

let server;
let base;
let modelReply = { subject: "Thank you", body: "Dear Sam, thank you for your gift.", unverified: [] };

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "donors-"));
  const store = createStore(join(dir, "db.json"));
  const app = createApp({
    store,
    demo: true,
    sessionSecret: "test",
    ask: async () => JSON.stringify(modelReply),
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

test("gifts need a positive amount and a sensible eligible amount", async () => {
  const drafter = await signIn("drafter");
  const donor = await (await call(drafter, "POST", "/api/agents/donor-receipts/records/donors", { name: "Sam Lee", email: "sam@example.org", mayContact: true })).json();
  const zero = await call(drafter, "POST", "/api/agents/donor-receipts/records/gifts", { donorId: donor.id, giftDate: "2026-10-01", amount: 0, giftType: "Cheque" });
  assert.equal(zero.status, 400);
  const benefit = await call(drafter, "POST", "/api/agents/donor-receipts/records/gifts", { donorId: donor.id, giftDate: "2026-10-01", amount: 100, eligibleAmount: 150, giftType: "Cheque" });
  assert.equal(benefit.status, 400);
});

test("a receipt cannot be issued until every required field is present, then numbers in sequence", async () => {
  const approver = await signIn("approver");
  const drafter = await signIn("drafter");

  await call(approver, "PUT", "/api/org", { name: "Demo Community Society", registrationNumber: "", receiptSignerName: "", address: "" });
  const donor = await (await call(drafter, "POST", "/api/agents/donor-receipts/records/donors", { name: "Pat Ng", mayContact: true })).json();
  const gift = await (await call(drafter, "POST", "/api/agents/donor-receipts/records/gifts", { donorId: donor.id, giftDate: "2026-10-02", amount: 250, giftType: "Cheque" })).json();

  const early = await call(approver, "POST", "/api/agents/donor-receipts/actions/issueReceipt", { recordId: gift.id });
  assert.equal(early.status, 400);
  const earlyText = (await early.json()).error;
  assert.match(earlyText, /registration number/);
  assert.match(earlyText, /mailing address/);

  await call(approver, "PUT", "/api/org", { name: "Demo Community Society", registrationNumber: "123456789RR0001", receiptSignerName: "Chris Doe", address: "1 Main St" });
  const noAddress = await call(approver, "POST", "/api/agents/donor-receipts/actions/issueReceipt", { recordId: gift.id });
  assert.match((await noAddress.json()).error, /mailing address/);

  await call(drafter, "PUT", `/api/records/${donor.id}`, { name: "Pat Ng", mayContact: true, address: "9 Oak Ave, Vancouver BC" });
  const issued = await call(approver, "POST", "/api/agents/donor-receipts/actions/issueReceipt", { recordId: gift.id });
  assert.equal(issued.status, 200);
  const body = await issued.json();
  assert.equal(body.receipt.number, "2026-0001");
  assert.equal(body.receipt.registrationNumber, "123456789RR0001");
  assert.equal(body.receipt.amount, 250);

  const again = await call(approver, "POST", "/api/agents/donor-receipts/actions/issueReceipt", { recordId: gift.id });
  assert.match((await again.json()).error, /already issued/);

  const edit = await call(drafter, "PUT", `/api/records/${gift.id}`, { donorId: donor.id, giftDate: "2026-10-02", amount: 300, giftType: "Cheque" });
  assert.equal(edit.status, 400);
});

test("drafters cannot issue receipts", async () => {
  const drafter = await signIn("drafter");
  const approver = await signIn("approver");
  const donor = await (await call(drafter, "POST", "/api/agents/donor-receipts/records/donors", { name: "Lee Park", mayContact: false })).json();
  const gift = await (await call(drafter, "POST", "/api/agents/donor-receipts/records/gifts", { donorId: donor.id, giftDate: "2026-10-03", amount: 20, giftType: "Card" })).json();
  const asDrafter = await call(drafter, "POST", "/api/agents/donor-receipts/actions/issueReceipt", { recordId: gift.id });
  assert.equal(asDrafter.status, 400);
  assert.match((await asDrafter.json()).error, /Only approvers/);
  assert.ok(approver);
});

test("a donor without email consent gets no email draft", async () => {
  const drafter = await signIn("drafter");
  const donor = await (await call(drafter, "POST", "/api/agents/donor-receipts/records/donors", { name: "No Consent", mayContact: false })).json();
  const refused = await call(drafter, "POST", "/api/agents/donor-receipts/draft", { kind: "lapsed", recordId: donor.id });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /consented/);
});

test("a thank-you draft waits for approval, placeholders block approval, and completion needs DONE", async () => {
  const drafter = await signIn("drafter");
  const approver = await signIn("approver");
  const donor = await (await call(drafter, "POST", "/api/agents/donor-receipts/records/donors", { name: "Kim Zhao", mayContact: true })).json();
  const gift = await (await call(drafter, "POST", "/api/agents/donor-receipts/records/gifts", { donorId: donor.id, giftDate: "2026-10-04", amount: 75, giftType: "Cash" })).json();

  modelReply = { subject: "Thanks", body: "Please come to [VENUE ADDRESS].", unverified: ["[VENUE ADDRESS]"] };
  const item = await (await call(drafter, "POST", "/api/agents/donor-receipts/draft", { kind: "thank_you", recordId: gift.id })).json();
  assert.equal(item.status, "pending");

  const blocked = await call(approver, "POST", `/api/items/${item.id}/approve`, { note: "" });
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /VENUE ADDRESS/);

  modelReply = { subject: "Thanks", body: "Dear Kim, thank you for your gift.", unverified: [] };
  const again = await (await call(drafter, "POST", "/api/agents/donor-receipts/draft", { kind: "thank_you", recordId: gift.id })).json();
  assert.equal((await call(approver, "POST", `/api/items/${again.id}/approve`, { note: "" })).status, 200);
  const early = await call(approver, "POST", `/api/items/${again.id}/complete`, { confirm: "SEND" });
  assert.equal(early.status, 400);
  const done = await call(approver, "POST", `/api/items/${again.id}/complete`, { confirm: "DONE" });
  assert.equal(done.status, 200);
  assert.equal((await done.json()).status, "done");
});

test("the summary lists gifts without receipts and donors who have lapsed", async () => {
  const drafter = await signIn("drafter");
  const old = await (await call(drafter, "POST", "/api/agents/donor-receipts/records/donors", { name: "Old Donor", mayContact: true })).json();
  await call(drafter, "POST", "/api/agents/donor-receipts/records/gifts", { donorId: old.id, giftDate: "2024-01-15", amount: 40, giftType: "Cheque" });
  const summary = await (await call(drafter, "GET", "/api/agents/donor-receipts/summary")).json();
  const receipts = summary.sections[0].rows;
  const lapsed = summary.sections[1].rows;
  assert.ok(receipts.some((row) => /Kim Zhao|Old Donor/.test(row.label)));
  assert.ok(lapsed.some((row) => row.label === "Old Donor" && row.consent === true));
});

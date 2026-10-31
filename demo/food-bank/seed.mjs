// Seeds a fictional food bank through the app's own HTTP API, so the demo data goes through the same rules as real use.
// Everything here is invented: the organization, the people, the amounts, and the dates.
export async function seedFoodBank(base, context) {
  const call = async (method, path, body) => {
    const res = await context.request.fetch(`${base}${path}`, { method, data: body });
    if (!res.ok()) throw new Error(`${method} ${path} failed: ${res.status()} ${await res.text()}`);
    return res.json();
  };
  const record = (agent, type, body) => call("POST", `/api/agents/${agent}/records/${type}`, body);

  await call("PUT", "/api/org", {
    name: "Riverbend Community Food Bank (fictional demo)",
    supportLine: "Call 555-0100 (fictional)",
    registrationNumber: "FICTIONAL-000",
    receiptSignerName: "Dana Okafor (fictional)",
    address: "100 Example Street, Riverbend (fictional)",
  });

  // Donor receipts
  const alex = await record("donor-receipts", "donors", { name: "Alex Morgan", email: "alex@example.com", address: "12 Elm Street, Riverbend", mayContact: true, notes: "" });
  const sam = await record("donor-receipts", "donors", { name: "Sam Rivera", email: "sam@example.com", address: "", mayContact: false, notes: "" });
  await record("donor-receipts", "gifts", { donorId: alex.id, giftDate: "2026-10-02", amount: 250, giftType: "Cheque", description: "" });
  await record("donor-receipts", "gifts", { donorId: sam.id, giftDate: "2026-10-14", amount: 80, giftType: "Cash", description: "" });

  // Volunteers
  for (const v of [
    { name: "Maria Lopez", email: "maria@example.com", role: "Driver", screeningStatus: "Cleared", screeningDate: "2026-03-02", mayContact: true },
    { name: "Tom Becker", email: "tom@example.com", role: "Driver", screeningStatus: "Submitted", mayContact: true },
    { name: "James Chen", email: "james@example.com", role: "Youth mentor", screeningStatus: "Not started", mayContact: true },
    { name: "Priya Patel", email: "priya@example.com", role: "Program volunteer", screeningStatus: "Not started", mayContact: false },
  ]) await record("volunteers", "volunteers", v);
  await record("volunteers", "shifts", { title: "Saturday pantry deliveries", date: "2026-11-07", role: "Driver", location: "Riverbend Community Hall", volunteersNeeded: 3 });
  await record("volunteers", "shifts", { title: "Youth homework helpers", date: "2026-11-12", role: "Youth mentor", location: "Riverbend Community Hall", volunteersNeeded: 2 });

  // Grants
  const funder = await record("grants", "funders", { name: "Riverbend Community Foundation (fictional)", deadline: "2026-12-01", amountRequested: 20000, status: "Drafting", programFocus: "Weekly food hampers for seniors", contactName: "Program officer (fictional)", notes: "" });
  await record("grants", "reports", { funderId: funder.id, dueDate: "2026-11-15", period: "Jan to Jun 2026", programResults: "Hampers delivered: 412 (fictional)", reportStatus: "Not started" });

  // Newsletter
  await record("newsletter", "subscribers", { name: "Dev Kapoor", email: "dev@example.com", consent: true, consentSource: "Sign-up form, Sept 2026" });
  await record("newsletter", "subscribers", { name: "Lee Park", email: "lee@example.com", consent: false, consentSource: "" });
  await record("newsletter", "updates", { title: "Autumn food drive", date: "2026-10-12", facts: "Collected 1,200 kg of food (fictional)" });
  await record("newsletter", "issues", { title: "November newsletter", month: "2026-11", updatesIncluded: "Autumn food drive" });

  // Governance
  await record("governance", "meetings", { title: "October board meeting", date: "2026-10-14", kind: "Board", attendees: "Chair, Treasurer (fictional)", agenda: "Treasurer's report\nVolunteer policy", notes: "Motion: approve the September minutes. Carried." });

  // Renewals
  await record("renewals", "members", { name: "Gwen Hughes", email: "gwen@example.com", membershipType: "Individual", paidUntil: "2026-06-30", mayContact: true });
  await record("renewals", "members", { name: "Omar Haddad", email: "omar@example.com", membershipType: "Family", paidUntil: "2026-11-20", mayContact: true });

  // Compliance
  await record("compliance", "obligations", { name: "Annual charity return", dueDate: "2026-10-15", owner: "Office manager (demo)", ownerEmail: "", recurrence: "Yearly", status: "Open", source: "Official charity return guidance (demo)" });
  await record("compliance", "obligations", { name: "Board AGM notice to members", dueDate: "2026-11-30", owner: "Board secretary (demo)", ownerEmail: "", recurrence: "Yearly", status: "Open", source: "Bylaws, section 4 (demo)" });

  // Events (the eighth agent is the events page)
  const harvest = await call("POST", "/api/events", { name: "Harvest pantry open house", date: "2026-11-08", time: "10 AM", format: "In person", location: "Riverbend Community Hall (fictional)", details: "Tours and sign-ups" });
  await call("POST", `/api/events/${harvest.id}/confirm`);
  await call("POST", "/api/events", { name: "Holiday hamper sign-up", date: "2026-12-05", time: "9 AM", format: "In person", location: "Riverbend Community Hall (fictional)" });
}

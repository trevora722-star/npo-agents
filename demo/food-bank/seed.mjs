// Seeds a fictional food bank through the app's own HTTP API, so the demo data goes through the same rules as real use.
// Everything here is invented: the organization, the people, the amounts, and the dates.
export async function seedFoodBank(base, context) {
  const call = async (method, path, body) => {
    const res = await context.request.fetch(`${base}${path}`, { method, data: body });
    if (!res.ok()) throw new Error(`${method} ${path} failed: ${res.status()} ${await res.text()}`);
    return res.json();
  };

  await call("PUT", "/api/org", {
    name: "Riverbend Community Food Bank (fictional demo)",
    supportLine: "Call 555-0100 (fictional)",
    registrationNumber: "FICTIONAL-000",
    receiptSignerName: "Dana Okafor (fictional)",
    address: "100 Example Street, Riverbend (fictional)",
  });

  const volunteers = {};
  for (const v of [
    { key: "maria", name: "Maria Lopez", email: "maria@example.com", role: "Driver", screeningStatus: "Cleared", screeningDate: "2026-03-02", mayContact: true },
    { key: "tom", name: "Tom Becker", email: "tom@example.com", role: "Driver", screeningStatus: "Submitted", mayContact: true },
    { key: "james", name: "James Chen", email: "james@example.com", role: "Youth mentor", screeningStatus: "Not started", mayContact: true },
    { key: "priya", name: "Priya Patel", email: "priya@example.com", role: "Program volunteer", screeningStatus: "Not started", mayContact: false },
  ]) {
    volunteers[v.key] = (await call("POST", "/api/agents/volunteers/records/volunteers", v)).id;
  }

  await call("POST", "/api/agents/volunteers/records/shifts", {
    title: "Saturday pantry deliveries", date: "2026-11-07", role: "Driver", location: "Riverbend Community Hall", volunteersNeeded: 3,
  });
  await call("POST", "/api/agents/volunteers/records/shifts", {
    title: "Youth homework helpers", date: "2026-11-12", role: "Youth mentor", location: "Riverbend Community Hall", volunteersNeeded: 2,
  });

  const donors = {};
  donors.alex = (await call("POST", "/api/agents/donor-receipts/records/donors", {
    name: "Alex Morgan", email: "alex@example.com", address: "12 Elm Street, Riverbend", mayContact: true, notes: "",
  })).id;
  donors.sam = (await call("POST", "/api/agents/donor-receipts/records/donors", {
    name: "Sam Rivera", email: "sam@example.com", address: "", mayContact: false, notes: "",
  })).id;

  await call("POST", "/api/agents/donor-receipts/records/gifts", { donorId: donors.alex, giftDate: "2026-10-02", amount: 250, giftType: "Cheque", description: "" });
  await call("POST", "/api/agents/donor-receipts/records/gifts", { donorId: donors.sam, giftDate: "2026-10-14", amount: 80, giftType: "Cash", description: "" });

  await call("POST", "/api/agents/compliance/records/obligations", {
    name: "Annual charity return", dueDate: "2026-10-15", owner: "Office manager (demo)", ownerEmail: "", recurrence: "Yearly", status: "Open", source: "Official charity return guidance (demo)",
  });
  await call("POST", "/api/agents/compliance/records/obligations", {
    name: "Board AGM notice to members", dueDate: "2026-11-30", owner: "Board secretary (demo)", ownerEmail: "", recurrence: "Yearly", status: "Open", source: "Bylaws, section 4 (demo)",
  });

  return { volunteers, donors };
}

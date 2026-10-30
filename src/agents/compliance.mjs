// Compliance calendar. The app tracks the dates you enter. It does not know government deadlines,
// so every date must come from the official source and be checked by the organization.
import { ValidationError } from "../events.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

const COMMON_OBLIGATIONS = [
  "CRA T3010 registered charity information return (check the due date for your fiscal year-end)",
  "Provincial annual report or filing for your society or nonprofit registration",
  "Annual general meeting and any notice to members",
  "Insurance renewals (liability, directors and officers, property)",
  "Privacy policy and consent review (PIPA in BC, PIPEDA federally)",
  "Anti-spam consent review for email lists (CASL)",
  "Payroll remittances and workers' compensation, if you have staff",
];

function nextDue(date, recurrence) {
  const d = new Date(date);
  if (recurrence === "Yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  if (recurrence === "Monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export default {
  id: "compliance",
  name: "Compliance calendar",
  summary: "Tracks the filings and renewals your organization must make, with reminders before each one is due.",

  recordTypes: {
    obligations: {
      label: "Obligations and deadlines",
      fields: [
        { name: "name", label: "Obligation", type: "text", required: true },
        { name: "dueDate", label: "Due date (YYYY-MM-DD, from the official source)", type: "date", required: true },
        { name: "owner", label: "Responsible person", type: "text", required: true },
        { name: "ownerEmail", label: "Responsible person's email", type: "text" },
        { name: "recurrence", label: "Repeats", type: "select", options: ["None", "Monthly", "Yearly"], required: true },
        { name: "status", label: "Status", type: "select", options: ["Open", "Done"], required: true },
        { name: "source", label: "Where the date came from (link or document)", type: "text", max: 300 },
      ],
    },
  },

  draftKinds: {
    due_reminder: { label: "Reminder to the responsible person", recordType: "obligations" },
  },

  canDraft(kind, record) {
    if (!record.ownerEmail) return "Add the responsible person's email first";
    if (record.status === "Done") return "This obligation is already done";
    return null;
  },

  buildDraft(kind, { record, org }) {
    return {
      system: `You write short internal reminders for a Canadian charity's staff and board. Staff review every draft before it is sent.
Rules: use only the facts given. Never invent dates or requirements. Under 120 words. Reply with only JSON: {"subject": "", "body": "", "unverified": []}.`,
      user: `Write a reminder to ${record.owner}.
Charity: ${org.name}
Obligation: ${record.name}
Due date: ${record.dueDate}
Source of the date: ${record.source || "[SOURCE NOT RECORDED]"}
Ask them to confirm the date with the official source and tell the team when it is done.`,
    };
  },

  summary({ records, today }) {
    const todayMs = Date.parse(today);
    const days = (date) => Math.round((Date.parse(date) - todayMs) / DAY_MS);
    const open = records.filter((r) => r.type === "obligations" && r.status !== "Done");
    const row = (r) => ({
      id: r.id,
      label: `${r.name} · due ${r.dueDate}`,
      detail: `${r.owner} · ${days(r.dueDate) < 0 ? `${-days(r.dueDate)} days overdue` : `${days(r.dueDate)} days left`}${r.source ? "" : " · no source recorded"}`,
    });
    return {
      title: "Compliance calendar",
      sections: [
        { heading: "Overdue", rows: open.filter((r) => days(r.dueDate) < 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(row) },
        { heading: "Due in the next 90 days", rows: open.filter((r) => days(r.dueDate) >= 0 && days(r.dueDate) <= 90).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(row) },
        { heading: "Common obligations to enter (add your own dates from the official source)", rows: COMMON_OBLIGATIONS.map((text, i) => ({ id: `common-${i}`, label: text, detail: "Not tracked until you add it" })) },
      ],
    };
  },

  actions: {
    markDone: {
      label: "Mark done (and schedule the next one if it repeats)",
      role: "approver",
      async run({ store, orgId, recordId }) {
        const row = await store.get("records", orgId, recordId);
        if (!row || row.agentId !== "compliance") throw new ValidationError("No such obligation");
        if (row.status === "Done") throw new ValidationError("Already done");
        const updated = await store.update("records", orgId, recordId, () => ({ status: "Done", completedAt: new Date().toISOString() }));
        if (row.recurrence === "None") return { record: updated };
        const next = await store.insert("records", {
          orgId,
          agentId: "compliance",
          type: "obligations",
          name: row.name,
          dueDate: nextDue(row.dueDate, row.recurrence),
          owner: row.owner,
          ownerEmail: row.ownerEmail || "",
          recurrence: row.recurrence,
          status: "Open",
          source: "",
        });
        return { record: next };
      },
    },
  },

  completion: { word: "DONE", label: "Mark as sent outside this app" },
};

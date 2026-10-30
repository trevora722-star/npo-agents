// Grant tracking and reporting. Drafts use only the funder details and program results staff enter.

const DAY_MS = 24 * 60 * 60 * 1000;
const STATUSES = ["Planning", "Drafting", "Submitted", "Awarded", "Declined", "Reporting", "Closed"];

export default {
  id: "grants",
  name: "Grant tracking and reporting",
  summary: "Keeps a funder calendar, flags deadlines, and drafts applications and progress reports from facts you enter.",

  recordTypes: {
    funders: {
      label: "Funders and applications",
      fields: [
        { name: "name", label: "Funder name", type: "text", required: true },
        { name: "deadline", label: "Application deadline (YYYY-MM-DD)", type: "date", required: true },
        { name: "amountRequested", label: "Amount requested (CAD)", type: "number" },
        { name: "status", label: "Status", type: "select", options: STATUSES, required: true },
        { name: "programFocus", label: "What the grant pays for", type: "textarea", max: 1500 },
        { name: "contactName", label: "Funder contact", type: "text" },
        { name: "notes", label: "Notes", type: "textarea", max: 1500 },
      ],
    },
    reports: {
      label: "Reports due",
      fields: [
        { name: "funderId", label: "Funder record ID", type: "text", required: true },
        { name: "dueDate", label: "Report due (YYYY-MM-DD)", type: "date", required: true },
        { name: "period", label: "Reporting period", type: "text", required: true },
        { name: "programResults", label: "Program results (facts only: numbers, dates, outcomes)", type: "textarea", max: 4000 },
        { name: "reportStatus", label: "Report status", type: "select", options: ["Not started", "Drafting", "Submitted"], required: true },
      ],
    },
  },

  validate(type, rec) {
    const errors = [];
    if (type === "funders" && rec.amountRequested !== null && rec.amountRequested < 0) errors.push("Amount requested cannot be negative");
    return errors;
  },

  draftKinds: {
    grant_application: { label: "Application section", recordType: "funders" },
    grant_report: { label: "Progress report", recordType: "reports" },
  },

  canDraft(kind, record) {
    if (kind === "grant_report" && !record.programResults) {
      return "Enter the program results first, so the report is built from real facts";
    }
    return null;
  },

  buildDraft(kind, { record, org }) {
    const system = `You draft grant documents for a Canadian charity. Staff review every draft before it is submitted.
Rules: use only the facts given. Never invent numbers, outcomes, dates, or partners. Mark any missing fact as a placeholder in square brackets and capitals, such as [PARTICIPANT COUNT]. Write plainly and concisely. Reply with only JSON: {"subject": "", "body": "", "unverified": []}.`;
    if (kind === "grant_application") {
      return {
        system,
        user: `Draft a short application section (under 300 words) describing what the grant would pay for.
Charity: ${org.name}
Funder: ${record.name}
Deadline: ${record.deadline}
Amount requested: ${record.amountRequested ?? "not set"}
What the grant pays for: ${record.programFocus || "[NOT PROVIDED]"}
Notes: ${record.notes || "none"}`,
      };
    }
    return {
      system,
      user: `Draft a progress report narrative (under 400 words) using only these results.
Charity: ${org.name}
Reporting period: ${record.period}
Program results: ${record.programResults}`,
    };
  },

  summary({ records, today }) {
    const todayMs = Date.parse(today);
    const funders = records.filter((r) => r.type === "funders");
    const reports = records.filter((r) => r.type === "reports");
    const days = (date) => Math.round((Date.parse(date) - todayMs) / DAY_MS);
    const upcoming = funders
      .filter((f) => !["Awarded", "Declined", "Closed"].includes(f.status) && days(f.deadline) >= 0 && days(f.deadline) <= 90)
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
      .map((f) => ({ id: f.id, label: `${f.name} · application due ${f.deadline}`, detail: `${days(f.deadline)} days · ${f.status}` }));
    const dueReports = reports
      .filter((r) => r.reportStatus !== "Submitted")
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((r) => ({ id: r.id, label: `Report for ${r.period} · due ${r.dueDate}`, detail: days(r.dueDate) < 0 ? `${-days(r.dueDate)} days overdue` : `${days(r.dueDate)} days · ${r.reportStatus}` }));
    return {
      title: "Grant calendar",
      sections: [
        { heading: "Applications due in the next 90 days", rows: upcoming },
        { heading: "Reports not yet submitted", rows: dueReports },
      ],
    };
  },

  actions: {},

  completion: { word: "DONE", label: "Mark as submitted outside this app" },
};


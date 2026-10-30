// Board and governance. Minutes record only the motions and decisions in the staff notes.
// The board approves minutes; the app never treats a draft as approved minutes.
import { ValidationError } from "../events.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

const AGM_CHECKLIST = [
  "Confirm the AGM date and notify members within the notice period in your bylaws",
  "Prepare the financial statements and the reviewer's or auditor's report (as your bylaws require)",
  "Prepare the annual report and the director election slate",
  "Confirm quorum rules and proxy or electronic voting arrangements",
  "Record the minutes of the AGM for board approval",
];

export default {
  id: "governance",
  name: "Board and governance",
  summary: "Drafts agendas and minutes from your notes, and keeps the AGM checklist in view.",

  recordTypes: {
    meetings: {
      label: "Meetings",
      fields: [
        { name: "title", label: "Meeting", type: "text", required: true },
        { name: "date", label: "Date (YYYY-MM-DD)", type: "date", required: true },
        { name: "kind", label: "Type", type: "select", options: ["Board", "Committee", "AGM"], required: true },
        { name: "attendees", label: "Attendees", type: "textarea", max: 1000 },
        { name: "agenda", label: "Agenda items (one per line)", type: "textarea", max: 3000 },
        { name: "notes", label: "Notes: discussion, motions, and decisions as they happened", type: "textarea", max: 8000 },
      ],
    },
  },

  draftKinds: {
    agenda: { label: "Agenda", recordType: "meetings" },
    minutes: { label: "Draft minutes", recordType: "meetings" },
  },

  canDraft(kind, record) {
    if (kind === "agenda" && !record.agenda) return "Enter the agenda items first";
    if (kind === "minutes" && !record.notes) return "Enter the meeting notes first";
    return null;
  },

  buildDraft(kind, { record, org }) {
    if (kind === "agenda") {
      return {
        system: `You draft board meeting agendas for a Canadian charity. Use only the items given. Reply with only JSON: {"subject": "", "body": "", "unverified": []}.`,
        user: `Draft a numbered agenda for a ${record.kind} meeting on ${record.date} for ${org.name}. Items:\n${record.agenda}`,
      };
    }
    return {
      system: `You draft minutes for a Canadian charity board. Rules:
1. Record only the motions, votes, and decisions that appear in the notes. Never add a motion or vote.
2. If a motion or vote is unclear or missing details, write [CONFIRM: what is unclear] in square brackets.
3. Write in neutral, past tense. Mark the minutes "DRAFT, not approved by the board".
Reply with only JSON: {"subject": "", "body": "", "unverified": []}.`,
      user: `Draft minutes for the ${record.kind} meeting of ${org.name} on ${record.date}.
Attendees: ${record.attendees || "[ATTENDEES NOT RECORDED]"}
Notes:
${record.notes}`,
    };
  },

  summary({ records, today }) {
    const todayMs = Date.parse(today);
    const meetings = records.filter((r) => r.type === "meetings");
    const upcoming = meetings
      .filter((m) => Date.parse(m.date) >= todayMs)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((m) => ({ id: m.id, label: `${m.title} · ${m.date}`, detail: `${m.kind} · ${Math.round((Date.parse(m.date) - todayMs) / DAY_MS)} days` }));
    const minutesWaiting = meetings
      .filter((m) => Date.parse(m.date) < todayMs && m.notes)
      .map((m) => ({ id: m.id, label: `${m.title} · ${m.date}`, detail: "Minutes not yet approved by the board" }));
    return {
      title: "Board and governance",
      sections: [
        { heading: "Upcoming meetings", rows: upcoming },
        { heading: "Minutes waiting for board approval", rows: minutesWaiting },
        { heading: "AGM checklist (check against your bylaws)", rows: AGM_CHECKLIST.map((text, i) => ({ id: `agm-${i}`, label: text, detail: "Check by hand" })) },
      ],
    };
  },

  // Minutes are only marked approved after the board votes. Agendas are marked done once circulated.
  completion(item) {
    if (item.kind === "minutes") {
      return {
        word: "APPROVED",
        label: "Mark as approved by the board",
        async run() {
          if (/\[CONFIRM/.test(item.body)) throw new ValidationError("Resolve every [CONFIRM] item before the board approves the minutes");
          return { recorded: "approved by board" };
        },
      };
    }
    return { word: "DONE", label: "Mark as circulated outside this app" };
  },
};

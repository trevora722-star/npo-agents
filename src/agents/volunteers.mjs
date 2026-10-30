// Volunteer coordination: roster, screening status, shifts, hours, and drafts for recruitment and welcome.
// Organizations set their own screening rules. This agent flags gaps; it does not decide who may volunteer.
const ROLES = ["Program volunteer", "Event helper", "Driver", "Youth mentor", "Board member"];
// Roles that work with children or vulnerable people. Screening must be cleared before these shifts are filled.
const SCREENED_ROLES = ["Youth mentor", "Driver"];

export default {
  id: "volunteers",
  name: "Volunteer coordination",
  summary: "Tracks volunteers, screening status, shifts, and hours. Flags shifts that need a cleared volunteer.",

  recordTypes: {
    volunteers: {
      label: "Volunteers",
      fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "email", label: "Email", type: "text" },
        { name: "role", label: "Main role", type: "select", options: ROLES, required: true },
        { name: "screeningStatus", label: "Screening status", type: "select", options: ["Not started", "Submitted", "Cleared"], required: true },
        { name: "screeningDate", label: "Date screening was cleared (YYYY-MM-DD)", type: "date" },
        { name: "mayContact", label: "May the charity contact this volunteer by email?", type: "bool" },
      ],
    },
    shifts: {
      label: "Shifts",
      fields: [
        { name: "title", label: "Shift title", type: "text", required: true },
        { name: "date", label: "Date (YYYY-MM-DD)", type: "date", required: true },
        { name: "role", label: "Role needed", type: "select", options: ROLES, required: true },
        { name: "location", label: "Location", type: "text" },
        { name: "volunteersNeeded", label: "Volunteers needed", type: "number", required: true },
        { name: "details", label: "Details", type: "textarea", max: 1000 },
      ],
    },
    hours: {
      label: "Hours logged",
      fields: [
        { name: "volunteerId", label: "Volunteer record ID", type: "text", required: true },
        { name: "date", label: "Date (YYYY-MM-DD)", type: "date", required: true },
        { name: "hours", label: "Hours", type: "number", required: true },
        { name: "activity", label: "Activity", type: "text" },
      ],
    },
  },

  validate(type, rec) {
    const errors = [];
    if (type === "shifts" && !(rec.volunteersNeeded > 0)) errors.push("Volunteers needed must be at least 1");
    if (type === "hours" && !(rec.hours > 0 && rec.hours <= 24)) errors.push("Hours must be more than 0 and at most 24 for one day");
    if (type === "volunteers" && rec.screeningStatus === "Cleared" && !rec.screeningDate) {
      errors.push("Enter the date screening was cleared");
    }
    return errors;
  },

  draftKinds: {
    shift_call: { label: "Volunteer call for a shift", recordType: "shifts" },
    welcome: { label: "Welcome email", recordType: "volunteers" },
  },

  canDraft(kind, record) {
    if (kind === "welcome" && !record.mayContact) return "This volunteer has not agreed to email, so no email can be drafted";
    return null;
  },

  buildDraft(kind, { record, org }) {
    const system = `You write warm, plain-language volunteer communications for a Canadian charity. Staff review every draft before it is sent.
Rules: use only the facts given. Never invent dates, places, or commitments. Keep placeholders in square brackets and capitals for anything missing. Under 180 words. Reply with only JSON: {"subject": "", "body": "", "unverified": []}.`;
    if (kind === "shift_call") {
      return {
        system,
        user: `Write a short call for volunteers for this shift.
Charity: ${org.name}
Shift: ${record.title}
Date: ${record.date}
Location: ${record.location || "[LOCATION]"}
Role: ${record.role}
Volunteers needed: ${record.volunteersNeeded}
Details: ${record.details || "none"}`,
      };
    }
    return {
      system,
      user: `Write a welcome email to a new volunteer.
Charity: ${org.name}
Volunteer name: ${record.name}
Main role: ${record.role}
Say that the charity will confirm the next steps and a contact person. Do not promise a start date.`,
    };
  },

  summary({ records, today }) {
    const volunteers = records.filter((r) => r.type === "volunteers");
    const shifts = records.filter((r) => r.type === "shifts");
    const hours = records.filter((r) => r.type === "hours");
    const yearStart = `${today.slice(0, 4)}-01-01`;

    const cleared = (role) => volunteers.filter((v) => v.role === role && v.screeningStatus === "Cleared").length;
    const shiftRows = shifts
      .filter((s) => s.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => {
        const notes = [];
        const available = cleared(s.role);
        if (SCREENED_ROLES.includes(s.role) && available < s.volunteersNeeded) {
          notes.push(`Needs ${s.volunteersNeeded} cleared volunteers; ${available} available`);
        }
        return { id: s.id, label: `${s.title} · ${s.date}`, detail: `${s.role} · ${s.volunteersNeeded} needed · ${available} cleared in this role${notes.length ? ` · ${notes.join("; ")}` : ""}` };
      });

    const screeningRows = volunteers
      .filter((v) => SCREENED_ROLES.includes(v.role) && v.screeningStatus !== "Cleared")
      .map((v) => ({ id: v.id, label: v.name, detail: `${v.role} · screening: ${v.screeningStatus}` }));

    const hoursRows = volunteers.map((v) => {
      const total = hours.filter((h) => h.volunteerId === v.id && h.date >= yearStart).reduce((sum, h) => sum + Number(h.hours), 0);
      return { id: v.id, label: v.name, detail: `${Math.round(total * 10) / 10} hours this year` };
    }).filter((row) => row.detail !== "0 hours this year");

    return {
      title: "Volunteers",
      sections: [
        { heading: "Upcoming shifts", rows: shiftRows },
        { heading: "Roles that need screening before placement, not yet cleared", rows: screeningRows },
        { heading: "Hours this year", rows: hoursRows },
      ],
    };
  },

  completion: { word: "DONE", label: "Mark as sent outside this app" },
};

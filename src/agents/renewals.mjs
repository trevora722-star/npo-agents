// Membership renewals. Reminders go only to members who agreed to email, and only after approval.
const DAY_MS = 24 * 60 * 60 * 1000;

export default {
  id: "renewals",
  name: "Membership renewals",
  summary: "Tracks membership terms, lists renewals coming due or lapsed, and drafts renewal reminders.",

  recordTypes: {
    members: {
      label: "Members",
      fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "email", label: "Email", type: "text" },
        { name: "membershipType", label: "Membership type", type: "select", options: ["Individual", "Family", "Organization"], required: true },
        { name: "paidUntil", label: "Membership paid until (YYYY-MM-DD)", type: "date" },
        { name: "mayContact", label: "Agreed to receive email from the charity?", type: "bool" },
      ],
    },
  },

  draftKinds: {
    renewal_reminder: { label: "Renewal reminder", recordType: "members" },
  },

  canDraft(kind, record) {
    if (!record.mayContact) return "This member has not agreed to email, so no reminder can be drafted";
    if (!record.email) return "Add the member's email first";
    return null;
  },

  buildDraft(kind, { record, org }) {
    return {
      system: `You write friendly membership renewal reminders for a Canadian charity. Staff review every draft before it is sent.
Rules: use only the facts given. Never state a renewal fee or a deadline that is not in the record. Use a placeholder in square brackets and capitals for the renewal link if one is not given. Under 150 words. Reply with only JSON: {"subject": "", "body": "", "unverified": []}.`,
      user: `Write a renewal reminder.
Charity: ${org.name}
Member name: ${record.name}
Membership type: ${record.membershipType}
Paid until: ${record.paidUntil || "not recorded"}`,
    };
  },

  summary({ records, today }) {
    const todayMs = Date.parse(today);
    const days = (date) => Math.round((Date.parse(date) - todayMs) / DAY_MS);
    const members = records.filter((r) => r.type === "members");
    const row = (m) => ({
      id: m.id,
      label: m.name,
      detail: `${m.membershipType} · ${m.paidUntil ? (days(m.paidUntil) < 0 ? `lapsed ${-days(m.paidUntil)} days ago` : `renews in ${days(m.paidUntil)} days`) : "no paid-until date"}${m.mayContact ? "" : " · no email consent"}`,
    });
    return {
      title: "Membership renewals",
      sections: [
        { heading: "Renewing in the next 60 days", rows: members.filter((m) => m.paidUntil && days(m.paidUntil) >= 0 && days(m.paidUntil) <= 60).sort((a, b) => a.paidUntil.localeCompare(b.paidUntil)).map(row) },
        { heading: "Lapsed memberships", rows: members.filter((m) => m.paidUntil && days(m.paidUntil) < 0).sort((a, b) => a.paidUntil.localeCompare(b.paidUntil)).map(row) },
      ],
    };
  },

  completion: { word: "DONE", label: "Mark as sent outside this app" },
};

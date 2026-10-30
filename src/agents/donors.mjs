// Donor stewardship and receipts. The app checks receipt fields and numbers receipts; a person issues them.
// Tax treatment and receipt wording must be confirmed against current CRA guidance before use.
import { ValidationError } from "../events.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const LAPSE_DAYS = 365;

// Fields a receipt needs. Each missing item is listed so staff can fix the record before issuing.
function receiptProblems(gift, donor, org) {
  const missing = [];
  if (!org.name) missing.push("Charity name");
  if (!org.registrationNumber) missing.push("Charity registration number");
  if (!org.receiptSignerName) missing.push("Name of the person who signs receipts");
  if (!donor) missing.push("Donor record");
  if (donor && !donor.name) missing.push("Donor name");
  if (donor && !donor.address) missing.push("Donor mailing address");
  if (!gift.giftDate) missing.push("Gift date");
  if (!(gift.amount > 0)) missing.push("Gift amount");
  return missing;
}


export default {
  id: "donor-receipts",
  name: "Donor stewardship and receipts",
  summary: "Tracks donors and gifts, checks receipt details, drafts thank-you and re-engagement emails.",

  recordTypes: {
    donors: {
      label: "Donors",
      fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "email", label: "Email", type: "text" },
        { name: "address", label: "Mailing address", type: "textarea", max: 400 },
        { name: "mayContact", label: "May the charity contact this donor by email? (CASL consent)", type: "bool" },
        { name: "notes", label: "Notes", type: "textarea", max: 1000 },
      ],
    },
    gifts: {
      label: "Gifts",
      fields: [
        { name: "donorId", label: "Donor record ID", type: "text", required: true },
        { name: "giftDate", label: "Gift date (YYYY-MM-DD)", type: "date", required: true },
        { name: "amount", label: "Amount (CAD)", type: "number", required: true },
        { name: "eligibleAmount", label: "Eligible amount, if the donor received a benefit", type: "number" },
        { name: "giftType", label: "Gift type", type: "select", options: ["Cash", "Cheque", "Card", "Other"], required: true },
        { name: "description", label: "Description (required for gifts in kind)", type: "textarea", max: 500 },
      ],
    },
  },

  validate(type, rec) {
    const errors = [];
    if (type === "gifts") {
      if (!(rec.amount > 0)) errors.push("Amount must be more than zero");
      if (rec.eligibleAmount !== null && rec.eligibleAmount !== "" && rec.eligibleAmount > rec.amount) {
        errors.push("Eligible amount cannot be more than the gift amount");
      }
      if (rec.giftType === "Other" && !rec.description) errors.push("Describe gifts of type Other");
    }
    return errors;
  },

  draftKinds: {
    thank_you: { label: "Thank-you email", recordType: "gifts", needs: "gift" },
    lapsed: { label: "Re-engagement email", recordType: "donors", needs: "donor" },
  },

  canDraft(kind, record, related) {
    if (kind === "lapsed" && !record.mayContact) return "This donor has not consented to email, so no email can be drafted";
    if (kind === "thank_you" && !related) return "The donor record for this gift is missing";
    if (kind === "thank_you" && !related.mayContact) return "This donor has not consented to email, so no email can be drafted";
    return null;
  },

  buildDraft(kind, { record, related, org }) {
    const system = `You write warm, plain-language donor emails for a Canadian charity. A staff member reviews every draft before it is sent.
Rules: use only the facts given. Never invent amounts, dates, tax advice, or promises about how money will be used. Sign off as the charity. Under 180 words. Reply with only JSON: {"subject": "", "body": "", "unverified": []}.`;
    if (kind === "thank_you") {
      return {
        system,
        user: `Write a thank-you email for a gift.
Charity: ${org.name}
Donor name: ${related.name}
Gift date: ${record.giftDate}
Amount: $${record.amount} CAD
Gift type: ${record.giftType}
Say that a tax receipt, if one applies, will be sent separately. Do not state any tax amount.`,
      };
    }
    return {
      system,
      user: `Write a re-engagement email to a donor who has not given in over a year. Invite them to reconnect with the charity's work without asking for a specific amount.
Charity: ${org.name}
Donor name: ${record.name}
Last gift date: ${record.lastGiftDate || "not recorded"}`,
    };
  },

  summary({ records, org, today }) {
    const donors = records.filter((r) => r.type === "donors");
    const gifts = records.filter((r) => r.type === "gifts");
    const byId = new Map(donors.map((d) => [d.id, d]));
    const todayMs = Date.parse(today);
    const receiptRows = gifts.filter((g) => !g.receiptNumber).map((g) => {
      const donor = byId.get(g.donorId);
      return { id: g.id, label: `${donor ? donor.name : "Unknown donor"} · $${g.amount} · ${g.giftDate}`, missing: receiptProblems(g, donor, org) };
    });
    const lapsed = donors.filter((d) => {
      const last = gifts.filter((g) => g.donorId === d.id).map((g) => Date.parse(g.giftDate)).sort((a, b) => b - a)[0];
      return last && todayMs - last > LAPSE_DAYS * DAY_MS;
    }).map((d) => ({ id: d.id, label: d.name, consent: !!d.mayContact }));
    return {
      title: "Receipts and donor follow-up",
      sections: [
        { heading: "Gifts without a receipt number", rows: receiptRows },
        { heading: `Donors with no gift in ${LAPSE_DAYS} days`, rows: lapsed },
      ],
    };
  },

  actions: {
    issueReceipt: {
      label: "Issue receipt number",
      role: "approver",
      async run({ store, org, user, recordId, orgId }) {
        const gift = await store.get("records", orgId, recordId);
        if (!gift || gift.agentId !== "donor-receipts" || gift.type !== "gifts") throw new ValidationError("No such gift");
        if (gift.receiptNumber) throw new ValidationError(`Receipt ${gift.receiptNumber} was already issued`);
        const donor = await store.get("records", orgId, gift.donorId);
        const missing = receiptProblems(gift, donor, org);
        if (missing.length) throw new ValidationError(`Cannot issue yet. Missing: ${missing.join("; ")}`);
        const year = gift.giftDate.slice(0, 4);
        const issued = (await store.list("records", orgId)).filter((r) => r.agentId === "donor-receipts" && r.receiptNumber && r.receiptNumber.startsWith(`${year}-`));
        const number = `${year}-${String(issued.length + 1).padStart(4, "0")}`;
        const updated = await store.update("records", orgId, recordId, () => ({ receiptNumber: number, receiptIssuedBy: user.email }));
        return { record: updated, receipt: { number, charity: org.name, registrationNumber: org.registrationNumber, donor: donor.name, donorAddress: donor.address, giftDate: gift.giftDate, amount: gift.amount, eligibleAmount: gift.eligibleAmount, signer: org.receiptSignerName } };
      },
    },
  },

  // Items of this kind are approved, then the staff member confirms they were sent outside the app.
  completion: { word: "DONE", label: "Mark as sent outside this app" },
};

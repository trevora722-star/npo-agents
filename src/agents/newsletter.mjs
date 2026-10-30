// Newsletter and communications. Sends only to subscribers who consented, and only with an unsubscribe line.
import { ValidationError } from "../events.mjs";

export default {
  id: "newsletter",
  name: "Newsletter and communications",
  summary: "Collects updates, drafts the newsletter and social posts from them, and sends only to consenting subscribers.",

  recordTypes: {
    subscribers: {
      label: "Subscribers",
      fields: [
        { name: "name", label: "Name", type: "text" },
        { name: "email", label: "Email", type: "text", required: true },
        { name: "consent", label: "Opted in to receive email?", type: "bool" },
        { name: "consentSource", label: "How consent was given (form, date, or event)", type: "text", max: 200 },
      ],
    },
    updates: {
      label: "Updates for communications",
      fields: [
        { name: "title", label: "Title", type: "text", required: true },
        { name: "date", label: "Date (YYYY-MM-DD)", type: "date" },
        { name: "facts", label: "What happened (facts only)", type: "textarea", required: true, max: 3000 },
      ],
    },
    issues: {
      label: "Newsletter issues",
      fields: [
        { name: "title", label: "Issue title", type: "text", required: true },
        { name: "month", label: "Month (YYYY-MM)", type: "text", required: true, max: 7 },
        { name: "updatesIncluded", label: "Updates to include (titles, one per line)", type: "textarea", max: 1500 },
      ],
    },
  },

  validate(type, rec) {
    const errors = [];
    if (type === "subscribers" && rec.consent && !rec.consentSource) errors.push("Record how consent was given");
    if (type === "issues" && !/^\d{4}-\d{2}$/.test(rec.month)) errors.push("Month must look like 2026-11");
    return errors;
  },

  draftKinds: {
    newsletter: { label: "Newsletter issue", recordType: "issues" },
    social_update: { label: "Social post about an update", recordType: "updates" },
  },

  canDraft(kind, record) {
    if (kind === "newsletter" && !record.updatesIncluded) return "List the updates to include first, so the newsletter uses real content";
    return null;
  },

  buildDraft(kind, { record, org }) {
    const system = `You write newsletter and social content for a Canadian charity. Staff review every draft before it is sent.
Rules: use only the facts given. Never invent events, numbers, quotes, or dates. Keep placeholders in square brackets and capitals for anything missing. Newsletters end with a line inviting readers to unsubscribe. Social posts stay under 60 words. Reply with only JSON: {"subject": "", "body": "", "unverified": []}.`;
    if (kind === "newsletter") {
      return {
        system,
        user: `Write the newsletter for ${record.month}, under 500 words.
Charity: ${org.name}
Issue title: ${record.title}
Updates to include:
${record.updatesIncluded}`,
      };
    }
    return {
      system,
      user: `Write a social post about this update.
Charity: ${org.name}
Title: ${record.title}
Facts: ${record.facts}`,
    };
  },

  summary({ records }) {
    const subscribers = records.filter((r) => r.type === "subscribers");
    const consented = subscribers.filter((s) => s.consent && s.consentSource);
    const unconsented = subscribers.filter((s) => !(s.consent && s.consentSource));
    return {
      title: "Communications",
      sections: [
        { heading: "Subscribers who may receive email", rows: [{ id: "consented", label: `${consented.length} consented subscribers`, detail: "Only these people receive newsletters" }] },
        { heading: "Subscribers without recorded consent (never emailed)", rows: unconsented.map((s) => ({ id: s.id, label: s.email, detail: "No recorded consent" })) },
      ],
    };
  },

  // Newsletters go to consenting subscribers and need the unsubscribe line. Social posts are only marked done.
  completion(item) {
    if (item.kind === "newsletter") {
      return {
        word: "SEND",
        label: "Send to consenting subscribers",
        async run({ store, orgId }) {
          if (!/unsubscribe/i.test(item.body)) {
            throw new ValidationError("Add an unsubscribe line to the newsletter before sending");
          }
          const subscribers = (await store.list("records", orgId)).filter((r) => r.agentId === "newsletter" && r.type === "subscribers");
          const recipients = subscribers.filter((s) => s.consent && s.consentSource);
          if (!recipients.length) throw new ValidationError("No subscribers have recorded consent");
          return { simulated: true, provider: "Simulated", recipientCount: recipients.length };
        },
      };
    }
    return { word: "DONE", label: "Mark as posted outside this app" };
  },
};

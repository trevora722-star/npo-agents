// Drafting, review, and the rules for when a draft may leave the app.
import { askModel, extractJson, ModelFormatError } from "./model.mjs";
import { ValidationError } from "./events.mjs";

export const DRAFT_TYPES = ["reminder", "followup", "social"];
export const PLACEHOLDER = /\[[A-Z][A-Z \/-]+\]/;

const TYPE_BRIEF = {
  reminder: "a reminder email sent a few days before the event",
  followup: "a thank-you and follow-up email sent after the event",
  social: "a short social media post announcing the event, under 60 words",
};

export const DRAFT_SYSTEM = `You write draft communications for a nonprofit organization. A staff member reviews every draft before anything is sent. You never send anything.

Rules:
1. Use only facts in the event record. Never invent dates, times, places, prices, names, phone numbers, or links.
2. When a needed fact is missing, write a placeholder in square brackets and capitals, such as [VENUE ADDRESS], and list it in "unverified".
3. Sign off as the organization named in the record. Never use a personal name.
4. Write plainly and warmly. Make no medical, legal, or financial claims, and no promises of outcomes.
5. If the record includes a support line, add it on its own line near the end. Otherwise add nothing.
6. Email bodies stay under 250 words. Social posts stay under 60 words.

Reply with only a JSON object: {"subject": "", "body": "", "facts_used": [], "unverified": []}.`;

export function draftPrompt({ event, org, type }) {
  return `Write ${TYPE_BRIEF[type]}.

Organization: ${org.name}
Support line: ${org.supportLine || "(none)"}

Event record:
${JSON.stringify(event, null, 2)}`;
}

export function parseDraftReply(text) {
  const parsed = extractJson(text, "object");
  for (const key of ["subject", "body"]) {
    if (typeof parsed[key] !== "string" || !parsed[key].trim()) {
      throw new ModelFormatError(`The draft is missing "${key}"`);
    }
  }
  return {
    subject: parsed.subject.trim(),
    body: parsed.body.trim(),
    facts_used: Array.isArray(parsed.facts_used) ? parsed.facts_used.map(String) : [],
    unverified: Array.isArray(parsed.unverified) ? parsed.unverified.map(String) : [],
  };
}

export async function generateDraft({ event, org, type, ask = askModel }) {
  if (!DRAFT_TYPES.includes(type)) throw new ValidationError("Unknown draft type");
  const system = DRAFT_SYSTEM;
  try {
    return parseDraftReply(await ask({ system, user: draftPrompt({ event, org, type }) }));
  } catch (err) {
    if (!(err instanceof ModelFormatError)) throw err;
    // One retry: the model sometimes replies without the JSON object.
    return parseDraftReply(await ask({ system, user: draftPrompt({ event, org, type }) }));
  }
}

// The placeholder names still present, such as "[VENUE ADDRESS]".
export function placeholdersIn(draft) {
  return [draft.subject, draft.body].flatMap((text) => text.match(new RegExp(PLACEHOLDER.source, "g")) || []);
}

// Reasons a draft may not go out. An empty list means it may.
export function sendBlockers(draft, { channel }) {
  const reasons = [];
  if (draft.status === "sent") reasons.push("This draft was already sent");
  else if (draft.status !== "approved") reasons.push(`The draft is ${draft.status}; it must be approved first`);
  if (channel === "email" && draft.type === "social") reasons.push("Social posts go to social channels, not email");
  if (channel === "social" && draft.type !== "social") reasons.push("Only social post drafts can be posted");
  if (placeholdersIn(draft).length) reasons.push("The draft still has a placeholder, such as [VENUE ADDRESS]");
  return reasons;
}

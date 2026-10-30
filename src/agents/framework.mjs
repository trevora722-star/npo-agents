// Shared machinery for every agent: records (what the organization enters), items (drafts and
// tasks waiting for review), and the rules that move an item from draft to done.
import { askModel, extractJson, ModelFormatError } from "../model.mjs";
import { ValidationError } from "../events.mjs";

export const PLACEHOLDER = /\[[A-Z][A-Z \/-]+\]/g;

export function placeholdersIn(text) {
  return text.match(new RegExp(PLACEHOLDER.source, "g")) || [];
}

// Builds fields for a record from a form submission, keeping only fields the agent declares.
export function cleanRecord(agent, type, input) {
  const def = agent.recordTypes[type];
  if (!def) throw new ValidationError("Unknown record type");
  const out = {};
  for (const field of def.fields) {
    let value = input?.[field.name];
    if (field.type === "bool") value = value === true || value === "true";
    else if (field.type === "number") value = value === "" || value === undefined || value === null ? null : Number(value);
    else value = typeof value === "string" ? value.trim().slice(0, field.max || 500) : "";
    if (field.required && (value === "" || value === null || Number.isNaN(value))) {
      throw new ValidationError(`${field.label} is required`);
    }
    if (field.type === "date" && value && !isRealDate(value)) throw new ValidationError(`${field.label} must be a real date (YYYY-MM-DD)`);
    if (field.type === "select" && value && !field.options.includes(value)) throw new ValidationError(`${field.label} has an unknown value`);
    out[field.name] = value;
  }
  const errors = agent.validate ? agent.validate(type, out) : [];
  if (errors.length) throw new ValidationError(errors.join("; "));
  return out;
}

export function isRealDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

// Asks the model for a {subject, body, unverified} draft, retrying once if the reply has no JSON.
export async function askForDraft({ system, user, ask = askModel }) {
  const attempt = async () => {
    const parsed = extractJson(await ask({ system, user, maxTokens: 1500 }), "object");
    if (typeof parsed.body !== "string" || !parsed.body.trim()) throw new ModelFormatError("Draft has no body");
    return {
      subject: String(parsed.subject || "").trim().slice(0, 300),
      body: parsed.body.trim(),
      unverified: Array.isArray(parsed.unverified) ? parsed.unverified.map(String) : [],
    };
  };
  try {
    return await attempt();
  } catch (err) {
    if (!(err instanceof ModelFormatError)) throw err;
    return attempt();
  }
}

// Where an item may move. Keeps approval and completion rules in one place for every agent.
export function assertCanApprove(item) {
  if (item.status !== "pending") throw new ValidationError(`This item is already ${item.status}`);
  const left = [...placeholdersIn(item.subject || ""), ...placeholdersIn(item.body || "")];
  if (left.length) throw new ValidationError(`Fill in ${[...new Set(left)].join(", ")} before approving`);
}

export function assertCanEdit(item) {
  if (item.status !== "pending") throw new ValidationError(`This item is ${item.status}; only pending items can be edited`);
}

export function assertCanComplete(item, confirm, word) {
  if (item.status !== "approved") throw new ValidationError("Only approved items can be completed");
  if (confirm !== word) throw new ValidationError(`Type ${word} to confirm`);
}

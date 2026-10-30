// Events for one organization. New events start "proposed" and need an approver to confirm them.
import { askModel, extractJson, ModelFormatError } from "./model.mjs";

const TEXT_FIELDS = ["name", "time", "format", "location", "audience", "audienceList", "details", "registrationLink", "contact"];
const MAX_LENGTH = 500;

export const EXTRACT_SYSTEM = `You read text from an organization's newsletter or web page and list the upcoming events it describes.

Rules:
1. Include only events the text describes. Never invent an event, date, time, place, or link.
2. Skip events whose date has already passed on the date you are given.
3. Dates become YYYY-MM-DD. If the text has no year, use the next occurrence of that month and day on or after the given date. For a date range, use the first day.
4. Use an empty string for any field the text does not state.
5. Copy registration links exactly as written.

Reply with only a JSON array. Each item has: name, date, time, format, location, audience, details, registrationLink, contact, sourceQuote (the sentence the event came from).`;

export function cleanEvent(input) {
  const event = {};
  for (const field of TEXT_FIELDS) {
    const value = input?.[field];
    event[field] = typeof value === "string" ? value.trim().slice(0, MAX_LENGTH) : "";
  }
  if (!event.name) throw new ValidationError("An event needs a name");
  const date = typeof input?.date === "string" ? input.date.trim() : "";
  // Date.parse rolls invalid days over (Feb 31 becomes Mar 3), so check the date round-trips unchanged.
  const roundTrips = !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !roundTrips) {
    throw new ValidationError("Date must be a real date in YYYY-MM-DD form");
  }
  event.date = date;
  return event;
}

export function parseExtractedEvents(text) {
  const list = extractJson(text, "array");
  if (!Array.isArray(list)) throw new ModelFormatError("Expected a list of events");
  return list
    .filter((item) => item && typeof item.name === "string" && item.name.trim())
    .map((item) => ({ ...item, sourceQuote: typeof item.sourceQuote === "string" ? item.sourceQuote : "" }));
}

// Turns pasted text into proposed events. Items without a usable date are skipped, never guessed.
export async function proposeEventsFromText({ text, today, ask = askModel }) {
  const reply = await ask({ system: EXTRACT_SYSTEM, user: `Today: ${today}\n\nText:\n${text}`, maxTokens: 2500 });
  const found = parseExtractedEvents(reply);
  const proposed = [];
  let skipped = 0;
  for (const item of found) {
    try {
      proposed.push({ ...cleanEvent(item), sourceQuote: item.sourceQuote });
    } catch {
      skipped += 1;
    }
  }
  return { proposed, skipped };
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

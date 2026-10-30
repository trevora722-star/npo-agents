// Calls the Claude Messages API. No SDK, so there are no extra dependencies.
const API_URL = "https://api.anthropic.com/v1/messages";

export async function askModel({ system, user, maxTokens = 1200, apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.CLAUDE_MODEL || "claude-sonnet-5-5" }) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set on the server");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Model request failed with status ${res.status}`);
  const data = await res.json();
  return data.content.filter((block) => block.type === "text").map((block) => block.text).join("");
}

// Pulls the first JSON value of the given kind out of a model reply.
export function extractJson(text, kind) {
  const [open, close] = kind === "array" ? ["[", "]"] : ["{", "}"];
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start === -1 || end === -1 || end < start) throw new ModelFormatError("The model reply had no JSON");
  return JSON.parse(text.slice(start, end + 1));
}

export class ModelFormatError extends Error {}

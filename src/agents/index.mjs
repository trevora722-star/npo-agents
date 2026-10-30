// The agents available in this build. Add a module here to offer it to organizations.
import donors from "./donors.mjs";
import grants from "./grants.mjs";
import volunteers from "./volunteers.mjs";
import newsletter from "./newsletter.mjs";
import compliance from "./compliance.mjs";
import governance from "./governance.mjs";
import renewals from "./renewals.mjs";

export const AGENTS = [donors, grants, volunteers, newsletter, compliance, governance, renewals];

export function getAgent(id) {
  return AGENTS.find((agent) => agent.id === id) || null;
}

// What the web page needs to draw an agent: record forms, draft kinds, and actions. No functions.
export function describeAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    summary: agent.summary,
    recordTypes: Object.fromEntries(Object.entries(agent.recordTypes).map(([key, def]) => [key, { label: def.label, fields: def.fields }])),
    draftKinds: Object.fromEntries(Object.entries(agent.draftKinds || {}).map(([key, def]) => [key, { label: def.label, recordType: def.recordType }])),
    actions: Object.fromEntries(Object.entries(agent.actions || {}).map(([key, def]) => [key, { label: def.label, role: def.role }])),
    completion: agent.completion ? { word: agent.completion.word, label: agent.completion.label } : null,
  };
}

// Sending and posting. Every path checks the same rules: approved draft, no placeholders, a chosen
// audience or connected channel, and the typed word SEND. Only the simulated provider is implemented.
import { sendBlockers } from "./drafts.mjs";
import { ValidationError } from "./events.mjs";

export const SOCIAL_CHANNELS = ["Facebook", "Instagram"];

export class NotConnectedError extends Error {
  constructor(name) {
    super(`${name} is not connected for this organization yet`);
    this.status = 501;
  }
}

// Stands in for a real email platform. It sends nothing. Counts are sample numbers.
export function createSimulatedProvider() {
  const audiences = [
    { name: "Program participants", recipients: 40 },
    { name: "Family members", recipients: 120 },
    { name: "All newsletter subscribers", recipients: 900 },
  ];
  return {
    name: "Simulated",
    simulated: true,
    async listAudiences() {
      return audiences;
    },
    async sendEmail({ audience, draft }) {
      return { simulated: true, provider: "Simulated", campaignId: `sim-${draft.id}`, recipientCount: audience.recipients };
    },
    async postSocial({ channel, draft }) {
      return { simulated: true, provider: "Simulated", channel, postId: `sim-${draft.id}-${channel}` };
    },
  };
}

// Placeholder for a real connection. It lists nothing and refuses every send.
export function createUnconnectedProvider(name) {
  return {
    name,
    simulated: false,
    async listAudiences() {
      throw new NotConnectedError(name);
    },
    async sendEmail() {
      throw new NotConnectedError(name);
    },
    async postSocial() {
      throw new NotConnectedError(name);
    },
  };
}

export const PROVIDERS = {
  simulated: createSimulatedProvider,
  constant_contact: () => createUnconnectedProvider("Constant Contact"),
};

export function providerFor(org) {
  const make = PROVIDERS[org.sendingProvider || "simulated"];
  if (!make) throw new ValidationError("Unknown sending provider");
  return make();
}

export async function sendEmailDraft({ store, org, user, draftId, audienceName, confirm, provider = providerFor(org) }) {
  if (confirm !== "SEND") throw new ValidationError('Type SEND to confirm');
  const draft = await store.get("drafts", org.id, draftId);
  if (!draft) throw new ValidationError("No such draft");

  const reasons = sendBlockers(draft, { channel: "email" });
  if (reasons.length) throw new ValidationError(`Not sent: ${reasons.join("; ")}`);

  const audience = (await provider.listAudiences()).find((a) => a.name === audienceName);
  if (!audience) throw new ValidationError("Choose an audience list");

  const result = await provider.sendEmail({ audience, draft });

  // Re-check inside the write so two clicks cannot both send the same draft.
  const sent = await store.update("drafts", org.id, draftId, (current) => {
    const again = sendBlockers(current, { channel: "email" });
    if (again.length) throw new ValidationError(`Not sent: ${again.join("; ")}`);
    return { status: "sent", sendResult: { ...result, audience: audience.name, by: user.email, at: new Date().toISOString() } };
  });
  return sent;
}

export async function postSocialDraft({ store, org, user, draftId, channel, confirm, provider = providerFor(org) }) {
  if (confirm !== "SEND") throw new ValidationError('Type SEND to confirm');
  if (!SOCIAL_CHANNELS.includes(channel)) throw new ValidationError("Unknown channel");
  if (!(org.socialChannels || []).includes(channel)) throw new ValidationError(`Connect ${channel} first`);
  const draft = await store.get("drafts", org.id, draftId);
  if (!draft) throw new ValidationError("No such draft");

  const reasons = sendBlockers(draft, { channel: "social" });
  if (reasons.length) throw new ValidationError(`Not posted: ${reasons.join("; ")}`);

  const result = await provider.postSocial({ channel, draft });

  return store.update("drafts", org.id, draftId, (current) => {
    const again = sendBlockers(current, { channel: "social" });
    if (again.length) throw new ValidationError(`Not posted: ${again.join("; ")}`);
    return { status: "sent", sendResult: { ...result, channel, by: user.email, at: new Date().toISOString() } };
  });
}

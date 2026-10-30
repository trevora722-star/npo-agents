// HTTP API and the web app. Every route reads the organization from the signed-in session.
import express from "express";
import session from "express-session";
import { fileURLToPath } from "node:url";
import { NotFoundError } from "./store.mjs";
import { ValidationError, cleanEvent, proposeEventsFromText } from "./events.mjs";
import { DRAFT_TYPES, generateDraft, sendBlockers, placeholdersIn } from "./drafts.mjs";
import { SOCIAL_CHANNELS, sendEmailDraft, postSocialDraft, providerFor } from "./sending.mjs";
import { askModel } from "./model.mjs";
import { mountAgentRoutes } from "./agent-routes.mjs";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const DEMO_ORG_ID = "demo-org";

// options: store, demo, sessionSecret, ask (model call), today (for newsletter parsing), secureCookies
export function createApp(options) {
  const { store, demo = false, sessionSecret, ask = askModel, today = () => new Date().toISOString().slice(0, 10), secureCookies = false } = options;
  const app = express();
  app.use(express.json({ limit: "200kb" }));
  app.use(session({
    name: "nea.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: secureCookies, maxAge: 8 * 60 * 60 * 1000 },
  }));
  app.use(express.static(PUBLIC_DIR));

  const current = (req) => req.session.user || null;

  function requireUser(minRole) {
    return (req, res, next) => {
      const user = current(req);
      if (!user) return res.status(401).json({ error: "Sign in required" });
      if (minRole === "approver" && user.role !== "approver") {
        return res.status(403).json({ error: "Only approvers can do this" });
      }
      req.user = user;
      req.orgId = user.orgId;
      next();
    };
  }

  async function org(orgId) {
    const record = await store.get("orgs", orgId, orgId);
    if (!record) throw new NotFoundError("Organization not found");
    return record;
  }

  async function audit(orgId, user, action, details = {}) {
    await store.insert("audit", { orgId, action, actorEmail: user.email, details });
  }

  app.get("/api/config", (req, res) => res.json({ demo }));

  app.get("/api/me", (req, res) => res.json({ user: current(req) }));

  if (demo) {
    app.post("/auth/demo", wrap(async (req, res) => {
      if (!(await store.get("orgs", DEMO_ORG_ID, DEMO_ORG_ID))) {
        await store.insert("orgs", { id: DEMO_ORG_ID, orgId: DEMO_ORG_ID, name: "Demo Community Society", supportLine: "", sendingProvider: "simulated", socialChannels: [] });
      }
      const approver = req.body?.role === "approver";
      req.session.user = {
        email: approver ? "approver@demo.example" : "drafter@demo.example",
        name: approver ? "Demo Approver" : "Demo Drafter",
        role: approver ? "approver" : "drafter",
        orgId: DEMO_ORG_ID,
      };
      res.json({ user: req.session.user });
    }));
  }

  app.post("/auth/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

  app.get("/api/org", requireUser(), wrap(async (req, res) => res.json(await org(req.orgId))));

  app.put("/api/org", requireUser("approver"), wrap(async (req, res) => {
    const name = String(req.body?.name || "").trim().slice(0, 120);
    if (!name) throw new ValidationError("Organization name is required");
    const supportLine = String(req.body?.supportLine || "").trim().slice(0, 300);
    const registrationNumber = String(req.body?.registrationNumber || "").trim().slice(0, 40);
    const receiptSignerName = String(req.body?.receiptSignerName || "").trim().slice(0, 120);
    const address = String(req.body?.address || "").trim().slice(0, 300);
    const updated = await store.update("orgs", req.orgId, req.orgId, () => ({ name, supportLine, registrationNumber, receiptSignerName, address }));
    await audit(req.orgId, req.user, "org_updated");
    res.json(updated);
  }));

  app.get("/api/audiences", requireUser(), wrap(async (req, res) => {
    const record = await org(req.orgId);
    const provider = providerFor(record);
    let audiences = [];
    let connectionError = null;
    try {
      audiences = await provider.listAudiences();
    } catch (err) {
      connectionError = err.message;
    }
    res.json({ audiences, simulated: provider.simulated, connectionError, channels: SOCIAL_CHANNELS, connected: record.socialChannels || [] });
  }));

  app.post("/api/social/connect", requireUser("approver"), wrap(async (req, res) => {
    const channel = req.body?.channel;
    if (!SOCIAL_CHANNELS.includes(channel)) throw new ValidationError("Unknown channel");
    const updated = await store.update("orgs", req.orgId, req.orgId, (record) => {
      const set = new Set(record.socialChannels || []);
      if (set.has(channel)) set.delete(channel);
      else set.add(channel);
      return { socialChannels: [...set] };
    });
    await audit(req.orgId, req.user, "social_connection_changed", { channel, connected: updated.socialChannels.includes(channel) });
    res.json({ connected: updated.socialChannels });
  }));

  mountAgentRoutes(app, { store, ask, today: () => today(), requireUser, org, audit });

  // Events
  app.get("/api/events", requireUser(), wrap(async (req, res) => {
    res.json(await store.list("events", req.orgId));
  }));

  app.post("/api/events", requireUser(), wrap(async (req, res) => {
    const fields = cleanEvent(req.body);
    const event = await store.insert("events", { orgId: req.orgId, ...fields, status: "proposed", source: "manual", createdBy: req.user.email });
    await audit(req.orgId, req.user, "event_added", { eventId: event.id });
    res.status(201).json(event);
  }));

  app.post("/api/events/import", requireUser(), wrap(async (req, res) => {
    const text = String(req.body?.text || "").trim();
    if (text.length < 40) throw new ValidationError("Paste the events section of your newsletter first");
    if (text.length > 60000) throw new ValidationError("That is too long; paste only the events section");
    const { proposed, skipped } = await proposeEventsFromText({ text, today: today(), ask });
    const added = [];
    for (const item of proposed) {
      added.push(await store.insert("events", { orgId: req.orgId, ...item, status: "proposed", source: "newsletter", createdBy: req.user.email }));
    }
    await audit(req.orgId, req.user, "events_imported", { found: proposed.length + skipped, added: added.length, skipped });
    res.status(201).json({ added, skipped });
  }));

  app.put("/api/events/:id", requireUser(), wrap(async (req, res) => {
    const existing = await store.get("events", req.orgId, req.params.id);
    if (!existing) throw new NotFoundError("No such event");
    if (existing.status === "confirmed" && req.user.role !== "approver") {
      throw new ValidationError("Only an approver can change a confirmed event");
    }
    const fields = cleanEvent({ ...existing, ...req.body });
    const updated = await store.update("events", req.orgId, req.params.id, () => fields);
    await audit(req.orgId, req.user, "event_edited", { eventId: updated.id });
    res.json(updated);
  }));

  app.post("/api/events/:id/confirm", requireUser("approver"), wrap(async (req, res) => {
    const updated = await store.update("events", req.orgId, req.params.id, () => ({ status: "confirmed" }));
    await audit(req.orgId, req.user, "event_confirmed", { eventId: updated.id });
    res.json(updated);
  }));

  app.delete("/api/events/:id", requireUser("approver"), wrap(async (req, res) => {
    await store.remove("events", req.orgId, req.params.id);
    await audit(req.orgId, req.user, "event_deleted", { eventId: req.params.id });
    res.json({ ok: true });
  }));

  // Drafts
  app.get("/api/drafts", requireUser(), wrap(async (req, res) => {
    res.json((await store.list("drafts", req.orgId)).reverse());
  }));

  app.post("/api/drafts", requireUser(), wrap(async (req, res) => {
    const { eventId, type } = req.body || {};
    if (!DRAFT_TYPES.includes(type)) throw new ValidationError("Unknown draft type");
    const event = await store.get("events", req.orgId, eventId);
    if (!event) throw new ValidationError("Unknown event");
    if (event.status !== "confirmed") throw new ValidationError("An approver must confirm this event first");
    const record = await org(req.orgId);
    const draft = await generateDraft({ event, org: record, type, ask });
    const saved = await store.insert("drafts", { orgId: req.orgId, eventId, type, status: "pending", createdBy: req.user.email, ...draft });
    await audit(req.orgId, req.user, "draft_created", { draftId: saved.id, type });
    res.status(201).json(saved);
  }));

  app.put("/api/drafts/:id", requireUser("approver"), wrap(async (req, res) => {
    const subject = String(req.body?.subject || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!subject || !body) throw new ValidationError("Subject and body cannot be empty");
    if (subject.length > 300 || body.length > 6000) throw new ValidationError("Draft is too long");
    const updated = await store.update("drafts", req.orgId, req.params.id, (draft) => {
      if (draft.status !== "pending") throw new ValidationError(`This draft is ${draft.status}; only pending drafts can be edited`);
      return { subject, body, editedAt: new Date().toISOString() };
    });
    await audit(req.orgId, req.user, "draft_edited", { draftId: updated.id });
    res.json(updated);
  }));

  for (const [route, status] of [["approve", "approved"], ["reject", "rejected"]]) {
    app.post(`/api/drafts/:id/${route}`, requireUser("approver"), wrap(async (req, res) => {
      const note = String(req.body?.note || "").slice(0, 500);
      const updated = await store.update("drafts", req.orgId, req.params.id, (draft) => {
        if (draft.status !== "pending") throw new ValidationError(`This draft is already ${draft.status}`);
        if (status === "approved" && placeholdersIn(draft).length) {
          throw new ValidationError(`Fill in ${placeholdersIn(draft).join(", ")} before approving`);
        }
        return { status, reviewerNote: note, reviewedBy: req.user.email, reviewedAt: new Date().toISOString() };
      });
      await audit(req.orgId, req.user, `draft_${status}`, { draftId: updated.id });
      res.json(updated);
    }));
  }

  app.get("/api/drafts/:id/check", requireUser("approver"), wrap(async (req, res) => {
    const draft = await store.get("drafts", req.orgId, req.params.id);
    if (!draft) throw new NotFoundError("No such draft");
    const blockers = sendBlockers(draft, { channel: draft.type === "social" ? "social" : "email" });
    res.json({ canSend: blockers.length === 0, blockers, placeholders: placeholdersIn(draft) });
  }));

  app.post("/api/drafts/:id/send", requireUser("approver"), wrap(async (req, res) => {
    const record = await org(req.orgId);
    const sent = await sendEmailDraft({ store, org: record, user: req.user, draftId: req.params.id, audienceName: req.body?.audience, confirm: req.body?.confirm });
    await audit(req.orgId, req.user, "email_sent", { draftId: sent.id, audience: req.body?.audience, simulated: !!sent.sendResult?.simulated });
    res.json(sent);
  }));

  app.post("/api/drafts/:id/post-social", requireUser("approver"), wrap(async (req, res) => {
    const record = await org(req.orgId);
    const posted = await postSocialDraft({ store, org: record, user: req.user, draftId: req.params.id, channel: req.body?.channel, confirm: req.body?.confirm });
    await audit(req.orgId, req.user, "social_posted", { draftId: posted.id, channel: req.body?.channel, simulated: !!posted.sendResult?.simulated });
    res.json(posted);
  }));

  app.get("/api/audit", requireUser("approver"), wrap(async (req, res) => {
    const rows = await store.list("audit", req.orgId);
    res.json(rows.slice(-200).reverse());
  }));

  app.use((err, req, res, next) => {
    if (err.status >= 400 && err.status < 600) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Check the server log." });
  });

  return app;
}

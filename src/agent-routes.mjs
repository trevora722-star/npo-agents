// Routes shared by every agent: records, drafts, review, completion, summaries, and actions.
import { AGENTS, getAgent, describeAgent } from "./agents/index.mjs";
import { cleanRecord, askForDraft, assertCanApprove, assertCanEdit, assertCanComplete } from "./agents/framework.mjs";
import { ValidationError } from "./events.mjs";
import { NotFoundError } from "./store.mjs";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// deps: { store, ask, today, requireUser, org, audit }
export function mountAgentRoutes(app, deps) {
  const { store, ask, today, requireUser, org, audit } = deps;

  async function agentRecord(orgId, agentId, recordId) {
    const row = await store.get("records", orgId, recordId);
    if (!row || row.agentId !== agentId) throw new NotFoundError("No such record");
    return row;
  }

  app.get("/api/agents", requireUser(), (req, res) => res.json(AGENTS.map(describeAgent)));

  app.get("/api/agents/:agent/records", requireUser(), wrap(async (req, res) => {
    const agent = requireAgent(req.params.agent);
    const rows = (await store.list("records", req.orgId)).filter((r) => r.agentId === agent.id);
    res.json(rows.reverse());
  }));

  app.post("/api/agents/:agent/records/:type", requireUser(), wrap(async (req, res) => {
    const agent = requireAgent(req.params.agent);
    const fields = cleanRecord(agent, req.params.type, req.body);
    const row = await store.insert("records", { orgId: req.orgId, agentId: agent.id, type: req.params.type, ...fields, createdBy: req.user.email });
    await audit(req.orgId, req.user, `${agent.id}_record_added`, { recordId: row.id, type: req.params.type });
    res.status(201).json(row);
  }));

  app.put("/api/records/:id", requireUser(), wrap(async (req, res) => {
    const existing = await store.get("records", req.orgId, req.params.id);
    if (!existing) throw new NotFoundError("No such record");
    const agent = requireAgent(existing.agentId);
    const fields = cleanRecord(agent, existing.type, { ...existing, ...req.body });
    const updated = await store.update("records", req.orgId, req.params.id, (row) => {
      if (row.receiptNumber) throw new ValidationError("This gift already has a receipt number and cannot be changed");
      return fields;
    });
    await audit(req.orgId, req.user, `${agent.id}_record_edited`, { recordId: updated.id });
    res.json(updated);
  }));

  app.delete("/api/records/:id", requireUser("approver"), wrap(async (req, res) => {
    const existing = await store.get("records", req.orgId, req.params.id);
    if (!existing) throw new NotFoundError("No such record");
    if (existing.receiptNumber) throw new ValidationError("Records with an issued receipt cannot be deleted");
    await store.remove("records", req.orgId, req.params.id);
    await audit(req.orgId, req.user, `${existing.agentId}_record_deleted`, { recordId: req.params.id });
    res.json({ ok: true });
  }));

  app.get("/api/agents/:agent/summary", requireUser(), wrap(async (req, res) => {
    const agent = requireAgent(req.params.agent);
    const records = (await store.list("records", req.orgId)).filter((r) => r.agentId === agent.id);
    const organization = await org(req.orgId);
    res.json(agent.summary ? agent.summary({ records, org: organization, today: today() }) : { title: agent.name, sections: [] });
  }));

  app.post("/api/agents/:agent/draft", requireUser(), wrap(async (req, res) => {
    const agent = requireAgent(req.params.agent);
    const kind = agent.draftKinds?.[req.body?.kind];
    if (!kind) throw new ValidationError("Unknown draft kind");
    const record = await agentRecord(req.orgId, agent.id, req.body?.recordId);
    if (record.type !== kind.recordType) throw new ValidationError("That draft is not for this kind of record");

    let related = null;
    if (kind.needs === "gift") related = await store.get("records", req.orgId, record.donorId);
    const blocked = agent.canDraft ? agent.canDraft(req.body.kind, record, related) : null;
    if (blocked) throw new ValidationError(blocked);

    const organization = await org(req.orgId);
    const prompt = agent.buildDraft(req.body.kind, { record, related, org: organization });
    const draft = await askForDraft({ system: prompt.system, user: prompt.user, ask });
    const item = await store.insert("items", {
      orgId: req.orgId,
      agentId: agent.id,
      kind: req.body.kind,
      recordId: record.id,
      status: "pending",
      createdBy: req.user.email,
      ...draft,
    });
    await audit(req.orgId, req.user, `${agent.id}_draft_created`, { itemId: item.id, kind: req.body.kind });
    res.status(201).json(item);
  }));

  app.get("/api/agents/:agent/items", requireUser(), wrap(async (req, res) => {
    const agent = requireAgent(req.params.agent);
    const rows = (await store.list("items", req.orgId)).filter((i) => i.agentId === agent.id).reverse();
    res.json(rows.map((item) => ({ ...item, completion: completionView(agent, item) })));
  }));

  app.put("/api/items/:id", requireUser("approver"), wrap(async (req, res) => {
    const subject = String(req.body?.subject || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!body) throw new ValidationError("The body cannot be empty");
    const updated = await store.update("items", req.orgId, req.params.id, (item) => {
      assertCanEdit(item);
      return { subject: subject.slice(0, 300), body: body.slice(0, 6000), editedAt: new Date().toISOString() };
    });
    await audit(req.orgId, req.user, "item_edited", { itemId: updated.id });
    res.json(updated);
  }));

  for (const [route, status] of [["approve", "approved"], ["reject", "rejected"]]) {
    app.post(`/api/items/:id/${route}`, requireUser("approver"), wrap(async (req, res) => {
      const note = String(req.body?.note || "").slice(0, 500);
      const updated = await store.update("items", req.orgId, req.params.id, (item) => {
        if (status === "approved") assertCanApprove(item);
        else if (item.status !== "pending") throw new ValidationError(`This item is already ${item.status}`);
        return { status, reviewerNote: note, reviewedBy: req.user.email, reviewedAt: new Date().toISOString() };
      });
      await audit(req.orgId, req.user, `item_${status}`, { itemId: updated.id });
      res.json(updated);
    }));
  }

  app.post("/api/items/:id/complete", requireUser("approver"), wrap(async (req, res) => {
    const item = await store.get("items", req.orgId, req.params.id);
    if (!item) throw new NotFoundError("No such item");
    const agent = requireAgent(item.agentId);
    const completion = typeof agent.completion === "function" ? agent.completion(item) : agent.completion;
    if (!completion) throw new ValidationError("This agent has nothing to complete");
    assertCanComplete(item, req.body?.confirm, completion.word);

    let result = {};
    if (completion.run) result = await completion.run({ item, store, org: await org(req.orgId), orgId: req.orgId, audience: req.body?.audience });

    const done = await store.update("items", req.orgId, item.id, (current) => {
      assertCanComplete(current, req.body?.confirm, completion.word);
      return { status: "done", completedBy: req.user.email, completedAt: new Date().toISOString(), result };
    });
    await audit(req.orgId, req.user, `${agent.id}_completed`, { itemId: done.id, simulated: !!result.simulated });
    res.json(done);
  }));

  app.post("/api/agents/:agent/actions/:name", requireUser(), wrap(async (req, res) => {
    const agent = requireAgent(req.params.agent);
    const action = agent.actions?.[req.params.name];
    if (!action) throw new NotFoundError("No such action");
    if (action.role === "approver" && req.user.role !== "approver") throw new ValidationError("Only approvers can do this");
    const outcome = await action.run({ store, org: await org(req.orgId), user: req.user, orgId: req.orgId, recordId: req.body?.recordId, body: req.body || {} });
    await audit(req.orgId, req.user, `${agent.id}_${req.params.name}`, { recordId: req.body?.recordId || null });
    res.json(outcome.record ? { record: outcome.record, receipt: outcome.receipt } : outcome);
  }));

  function completionView(agent, item) {
    const completion = typeof agent.completion === "function" ? agent.completion(item) : agent.completion;
    return completion ? { word: completion.word, label: completion.label } : null;
  }

  function requireAgent(id) {
    const agent = getAgent(id);
    if (!agent) throw new NotFoundError("No such agent");
    return agent;
  }
}


// Small JSON-file store. Every record carries an orgId, and every read is filtered by it,
// so one organization can never see another's events, drafts, or audit log.
// Replace with a real database before hosting for paying customers.
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const EMPTY = { orgs: [], events: [], drafts: [], audit: [], records: [], items: [] };

export function createStore(path) {
  let cache = null;
  let queue = Promise.resolve();

  async function load() {
    if (cache) return cache;
    try {
      cache = JSON.parse(await readFile(path, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      cache = structuredClone(EMPTY);
    }
    return cache;
  }

  async function save() {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(cache, null, 2));
    await rename(tmp, path);
  }

  // Writes run one at a time so concurrent requests can't overwrite each other.
  function mutate(fn) {
    const run = queue.then(async () => {
      const db = await load();
      const result = await fn(db);
      await save();
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    async list(collection, orgId) {
      const db = await load();
      return db[collection].filter((row) => row.orgId === orgId);
    },

    async get(collection, orgId, id) {
      const db = await load();
      return db[collection].find((row) => row.orgId === orgId && row.id === id) || null;
    },

    insert(collection, fields) {
      return mutate((db) => {
        const row = { id: randomUUID(), createdAt: new Date().toISOString(), ...fields };
        db[collection].push(row);
        return row;
      });
    },

    // fn receives the current row and returns the fields to merge in. It may throw to refuse the change.
    update(collection, orgId, id, fn) {
      return mutate(async (db) => {
        const row = db[collection].find((r) => r.orgId === orgId && r.id === id);
        if (!row) throw new NotFoundError("Not found");
        const changes = await fn(row);
        Object.assign(row, changes, { updatedAt: new Date().toISOString() });
        return row;
      });
    },

    remove(collection, orgId, id) {
      return mutate((db) => {
        const before = db[collection].length;
        db[collection] = db[collection].filter((r) => !(r.orgId === orgId && r.id === id));
        if (db[collection].length === before) throw new NotFoundError("Not found");
      });
    },
  };
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.status = 404;
  }
}

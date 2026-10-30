// Starts the app. Settings come from environment variables. See README.md.
import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { fileURLToPath } from "node:url";

const env = process.env;
const production = env.NODE_ENV === "production";
const demo = (env.DEMO_MODE || "true") === "true";

if (production && demo) throw new Error("Demo sign-in is not allowed in production. Set DEMO_MODE=false.");
if (production && !env.SESSION_SECRET) throw new Error("Set SESSION_SECRET in production.");

const dataFile = env.DATA_FILE || fileURLToPath(new URL("../data/db.json", import.meta.url));
const store = createStore(dataFile);
const appUrl = env.APP_URL || `http://localhost:${env.PORT || 3000}`;

const app = createApp({
  store,
  demo,
  sessionSecret: env.SESSION_SECRET || "local-only-secret-change-me",
  secureCookies: appUrl.startsWith("https://"),
});

const port = Number(env.PORT || 3000);
const host = env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Event coordination agent at http://${host}:${port} (demo sign-in: ${demo})`);
});

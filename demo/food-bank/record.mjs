// Runs the app with fictional food bank data and records a walkthrough video for each of the eight agents.
// Usage: node demo/food-bank/record.mjs <output-dir>
// Each video shows what the agent does, what staff must enter, one record entered through the UI with its
// save time, and the summary that updates from it. Captions are on-screen text, not narration.
// Timings are measured in this browser against this local server. They are not model timings.
import { spawn, execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { seedFoodBank } from "./seed.mjs";
import { AGENTS } from "../../src/agents/index.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(process.argv[2] || "food-bank-videos");
const workDir = join(outDir, "work");
const PORT = 3100;
const base = `http://127.0.0.1:${PORT}`;
const SIZE = { width: 1280, height: 800 };

// The entry each video makes through the UI. Values are fictional and pass each agent's own checks.
const WALKTHROUGHS = [
  { agent: "donor-receipts", file: "donor-receipts", type: "donors", marker: "Demo Donor Jordan", values: { name: "Demo Donor Jordan", email: "jordan@example.com", address: "7 Oak Lane, Riverbend", mayContact: "true", notes: "" } },
  { agent: "volunteers", file: "volunteers", type: "volunteers", marker: "Demo Volunteer Ana", values: { name: "Demo Volunteer Ana", email: "ana@example.com", role: "Driver", screeningStatus: "Submitted", mayContact: "true" } },
  { agent: "grants", file: "grants", type: "funders", marker: "Demo Foundation (fictional)", values: { name: "Demo Foundation (fictional)", deadline: "2027-01-15", amountRequested: "5000", status: "Planning", programFocus: "School breakfast program", contactName: "", notes: "" } },
  { agent: "newsletter", file: "newsletter", type: "subscribers", marker: "demo.reader@example.com", values: { name: "Demo Reader", email: "demo.reader@example.com", consent: "true", consentSource: "Event sign-up sheet, Oct 2026" } },
  { agent: "governance", file: "governance", type: "meetings", marker: "Demo AGM planning", values: { title: "Demo AGM planning", date: "2026-11-25", kind: "Committee", attendees: "Two directors (fictional)", agenda: "AGM date\nBudget", notes: "Motion: set the AGM for December 10. Carried." } },
  { agent: "compliance", file: "compliance", type: "obligations", marker: "Demo insurance renewal", values: { name: "Demo insurance renewal", dueDate: "2026-12-01", owner: "Office manager (demo)", ownerEmail: "", recurrence: "Yearly", status: "Open", source: "Insurance policy (fictional)" } },
  { agent: "renewals", file: "renewals", type: "members", marker: "Demo Member Ines", values: { name: "Demo Member Ines", email: "ines@example.com", membershipType: "Individual", paidUntil: "2026-08-31", mayContact: "true" } },
];

// Shows a caption bar on the page, so the video explains each step without narration.
async function caption(page, text) {
  await page.evaluate((t) => {
    let bar = document.getElementById("demo-caption");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "demo-caption";
      bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;padding:14px 20px;background:#1d2730;color:#fff;font:16px system-ui,sans-serif;z-index:9999";
      document.body.append(bar);
    }
    bar.textContent = t;
  }, text);
  await page.waitForTimeout(2600);
}

async function tab(page, name) {
  await page.locator(".tabs button", { hasText: name }).first().click();
  await page.waitForTimeout(300);
}

// Enters one record through the agent's own form, times the save, and returns the time in milliseconds.
async function enterRecord(page, walk, def) {
  await page.locator("summary", { hasText: `Add ${def.label.toLowerCase()}` }).click();
  for (const [name, value] of Object.entries(walk.values)) {
    const field = page.locator(`details form [name="${name}"]`);
    if ((await field.evaluate((e) => e.tagName)) === "SELECT") await field.selectOption(value);
    else await field.fill(value);
  }
  const start = Date.now();
  await page.locator("details form button[type=submit]").click();
  await page.locator("table tbody tr", { hasText: walk.marker }).first().waitFor({ timeout: 5000 });
  return Date.now() - start;
}

async function agentWalkthrough(page, walk, agent, timings) {
  const def = agent.recordTypes[walk.type];
  const required = Object.values(def.fields).filter((f) => f.required).map((f) => f.label.split("(")[0].trim());
  await page.getByRole("button", { name: agent.name, exact: true }).click();
  await page.waitForTimeout(500);
  await caption(page, `${agent.name}. ${agent.summary}`);
  await caption(page, "Summary: what needs attention, worked out from the records entered so far.");
  await tab(page, "Records");
  await page.getByRole("button", { name: def.label, exact: true }).click();
  await caption(page, `Setup, ${def.label.toLowerCase()} needed: ${required.join("; ")}.`);
  const ms = await enterRecord(page, walk, def);
  timings.push({ agent: agent.name, action: `Save one ${def.label.toLowerCase().replace(/s$/, "")}`, ms });
  await caption(page, `Saved and listed in ${ms} ms, measured in the browser against the local server.`);
  await tab(page, "Summary");
  await caption(page, "The summary updates from the record just entered.");
}

async function eventsWalkthrough(page, timings) {
  await caption(page, "Events: paste a newsletter's events or add them by hand. An approver confirms each one before drafts are made.");
  await caption(page, "Setup: event name and date are required. Other fields are optional.");
  await page.locator("summary", { hasText: /event/i }).first().click().catch(() => {});
  await page.locator('form [name="name"]').first().fill("Demo open house");
  await page.locator('form [name="date"]').first().fill("2026-11-20");
  await page.locator('form [name="location"]').first().fill("Riverbend Community Hall (fictional)");
  const start = Date.now();
  await page.getByRole("button", { name: "Save as proposed" }).click();
  await page.getByText("Demo open house").first().waitFor({ timeout: 5000 });
  timings.push({ agent: "Events and engagement", action: "Save one event", ms: Date.now() - start });
  await caption(page, `Saved as proposed in ${Date.now() - start} ms. It does not feed drafts until an approver confirms it.`);
}

const server = spawn(process.execPath, [join(repo, "src/server.mjs")], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DEMO_MODE: "true", DATA_FILE: join(workDir, "db.json") },
  stdio: ["ignore", "inherit", "inherit"],
});

try {
  await mkdir(workDir, { recursive: true });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

  const seedContext = await browser.newContext({ viewport: SIZE });
  await seedContext.request.post(`${base}/auth/demo`, { data: { role: "approver" } });
  await seedFoodBank(base, seedContext);
  await seedContext.close();

  const timings = [];
  for (const walk of WALKTHROUGHS) {
    const agent = AGENTS.find((a) => a.id === walk.agent);
    const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: workDir, size: SIZE } });
    await context.request.post(`${base}/auth/demo`, { data: { role: "approver" } });
    const page = await context.newPage();
    await page.goto(`${base}/agents.html`);
    await page.waitForTimeout(800);
    await agentWalkthrough(page, walk, agent, timings);
    await caption(page, "Demo data is fictional. Nothing is sent, and no real organization is shown.");
    const webm = await page.video().path();
    await context.close();
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(outDir, `${walk.file}.mp4`)]);
    console.log("wrote", `${walk.file}.mp4`);
  }

  // Events, the eighth agent, is on the main app page.
  const eventsContext = await browser.newContext({ viewport: SIZE, recordVideo: { dir: workDir, size: SIZE } });
  await eventsContext.request.post(`${base}/auth/demo`, { data: { role: "approver" } });
  const eventsPage = await eventsContext.newPage();
  await eventsPage.goto(`${base}/`);
  await eventsPage.waitForTimeout(800);
  await eventsWalkthrough(eventsPage, timings);
  await caption(eventsPage, "Demo data is fictional. Nothing is sent, and no real organization is shown.");
  const eventsWebm = await eventsPage.video().path();
  await eventsContext.close();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", eventsWebm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(outDir, "events.mp4")]);
  console.log("wrote events.mp4");

  await browser.close();
  await writeFile(join(outDir, "timings.json"), JSON.stringify(timings, null, 2));
  console.log(timings);
} finally {
  server.kill();
  await rm(workDir, { recursive: true, force: true });
}

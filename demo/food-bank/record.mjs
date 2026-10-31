// Runs the app with fictional food bank data and records short walkthrough videos of three agents.
// Usage: node demo/food-bank/record.mjs <output-dir>
// Uses demo sign-in on a local server. Captions are on-screen text, not narration.
import { spawn, execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { seedFoodBank } from "./seed.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(process.argv[2] || "food-bank-videos");
const workDir = join(outDir, "work");
const PORT = 3100;
const base = `http://127.0.0.1:${PORT}`;
const SIZE = { width: 1280, height: 800 };

await mkdir(workDir, { recursive: true });
const server = spawn(process.execPath, [join(repo, "src/server.mjs")], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DEMO_MODE: "true", DATA_FILE: join(workDir, "db.json") },
  stdio: ["ignore", "inherit", "inherit"],
});

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
  await page.waitForTimeout(2200);
}

// Opens an agent on its Summary tab, so every flow starts from the same screen.
async function openAgent(page, name) {
  await page.getByRole("button", { name }).first().click();
  await page.waitForTimeout(400);
  await openTab(page, "Summary");
}

async function openTab(page, name) {
  await page.locator(".tabs button", { hasText: name }).first().click();
  await page.waitForTimeout(400);
}

// Each flow runs in its own browser context, so each video starts from a clean page.
const flows = {
  "donor-receipts": {
    title: "Donor receipts",
    run: async (page) => {
      await caption(page, "Donor receipts: the agent finds gifts that still need a receipt number.");
      await openAgent(page, "Donor stewardship and receipts");
      await caption(page, "The summary lists gifts without a receipt number, and donors with no gift in the last year.");
      await openTab(page, "Records");
      await caption(page, "Records: Sam Rivera's donor record has no mailing address, so a receipt can't be issued yet.");
      await caption(page, "Staff add the address on the donor record. Numbers are set in order, and a person issues each receipt.");
    },
  },
  "volunteers": {
    title: "Volunteer coordination",
    run: async (page) => {
      await caption(page, "Volunteer coordination: the agent checks whether each shift has enough cleared volunteers.");
      await openAgent(page, "Volunteer coordination");
      await caption(page, "The summary shows shifts that need screened volunteers. Youth and driving roles need screening cleared first.");
      await openTab(page, "Records");
      await caption(page, "Records: one driver has cleared screening. The Saturday delivery shift needs three.");
    },
  },
  "compliance": {
    title: "Compliance calendar",
    run: async (page) => {
      await caption(page, "Compliance calendar: deadlines the organization enters, with overdue items first.");
      await openAgent(page, "Compliance calendar");
      await caption(page, "The summary lists overdue items and upcoming deadlines. The app does not know government deadlines; staff enter them from official sources.");
    },
  },
};

try {
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

  // Seed once, through a throwaway context.
  const seedContext = await browser.newContext({ viewport: SIZE });
  await seedContext.request.post(`${base}/auth/demo`, { data: { role: "approver" } });
  await seedFoodBank(base, seedContext);
  await seedContext.close();

  for (const [id, flow] of Object.entries(flows)) {
    const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: workDir, size: SIZE } });
    await context.request.post(`${base}/auth/demo`, { data: { role: "approver" } });
    const page = await context.newPage();
    await page.goto(`${base}/agents.html`);
    await page.waitForTimeout(800);
    await flow.run(page);
    await caption(page, "Demo data is fictional. Nothing is sent, and no real organization is shown.");
    const webm = await page.video().path();
    await context.close();
    const mp4 = join(outDir, `${id}.mp4`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
    console.log("wrote", mp4);
  }
  await browser.close();
} finally {
  server.kill();
  await rm(workDir, { recursive: true, force: true });
}

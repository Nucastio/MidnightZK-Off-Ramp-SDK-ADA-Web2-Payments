#!/usr/bin/env node
/**
 * Records a demo walkthrough of the MidnightZK Off-Ramp SDK UI driven through
 * the full 6-step pipeline against the REAL Wise sandbox (RAIL_ADAPTER_MODE=sandbox,
 * WISE_API_TOKEN from .env).
 *
 * Outputs:
 *   test-results/demo-record-offramp-demo-walkthrough/video.webm
 *   test-results/demo-record-offramp-demo-walkthrough/beats.json   (timings for narration)
 *
 * Then run scripts/build-narration.py to add audio + burned subtitles → docs/media/offramp-demo.mp4
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
process.chdir(repoRoot);

const API_PORT = 8899;
const UI_PORT = 5181;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const UI_URL = `http://127.0.0.1:${UI_PORT}/?api=${encodeURIComponent(API_URL)}`;

const outDir = join(repoRoot, "test-results", "demo-record-offramp-demo-walkthrough");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- spawn helpers ----------
const children = [];
const spawnBg = (cmd, args, opts = {}) => {
  const c = spawn(cmd, args, { stdio: "pipe", ...opts });
  children.push(c);
  c.stdout?.on("data", (d) => process.stdout.write(`[${cmd.split("/").pop()}] ${d}`));
  c.stderr?.on("data", (d) => process.stderr.write(`[${cmd.split("/").pop()}] ${d}`));
  return c;
};
const killAll = () => { for (const c of children) { try { c.kill("SIGTERM"); } catch {} } };
process.on("SIGINT", () => { killAll(); process.exit(130); });

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.status === 200) return; } catch {}
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function killExistingOnPort(port) {
  try {
    const { execSync } = await import("node:child_process");
    const pids = execSync(`lsof -t -i:${port} 2>/dev/null || true`, { encoding: "utf8" }).trim();
    if (pids) {
      console.log(`killing existing process on port ${port}: ${pids}`);
      execSync(`kill -9 ${pids} 2>/dev/null || true`);
      await sleep(500);
    }
  } catch {}
}

// ---------- demo beats ----------
// Each beat: { id, caption, narration, run(page) action, holdMs minimum hold time }
const beats = [
  {
    id: "intro",
    caption: "MidnightZK Off-Ramp SDK — ADA → fiat with ZK privacy",
    narration: "Welcome to the MidnightZK Off-Ramp SDK demo. This is a non-custodial off-ramp that moves Cardano ADA into web2 payment rails like Wise, with payer privacy guaranteed by Midnight zero-knowledge proofs.",
    run: async () => { /* nothing — just show the hero */ },
    holdMs: 14500,
  },
  {
    id: "env-strip",
    caption: "Cardano Preprod + Midnight circuit + LIVE Wise sandbox",
    narration: "Across the top of the UI you can see the live environment. Cardano Preprod via Blockfrost. The Midnight Compact circuit. And, importantly for this demo, the rail mode is set to sandbox — meaning real Wise sandbox API calls.",
    run: async (page) => { await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })); },
    holdMs: 15000,
  },
  {
    id: "initiate-fill",
    caption: "Step 1 — Initiate. Pick Wise, $1.50 USD, payee $alice",
    narration: "Step one. Initiate an off-ramp intent. We pick the Wise rail, one dollar fifty US, payee handle dollar alice. The S D K derives the payee and amount commitments off-chain. No on-chain transaction yet.",
    run: async (page) => {
      await page.selectOption("#f-adapter", "wise");
      await page.fill("#f-fiat", "1.50");
      await page.fill("#f-payee", "$alice");
      await sleep(700);
      await page.click("#btn-initiate");
      await page.waitForSelector("#r-initiate:not([hidden])", { timeout: 10000 });
    },
    holdMs: 14800,
  },
  {
    id: "skip-lock",
    caption: "Step 2 — Skip LOCK (using existing Preprod evidence)",
    narration: "Step two — lock A D A on Cardano. We've already executed real Preprod lock transactions off-camera — five of them, with hashes recorded in the testnet evidence document. So we skip and use the existing lock for this run.",
    run: async (page) => {
      await page.click("#btn-skip-lock");
      await sleep(800);
    },
    holdMs: 15200,
  },
  {
    id: "prove",
    caption: "Step 3 — Midnight zk-SNARK proof (< 1 second)",
    narration: "Step three. The Midnight zero-knowledge prover binds payee, amount, and the rail quote — without revealing any of them. Under one second in practice.",
    run: async (page) => {
      await page.click("#btn-prove");
      await page.waitForSelector("#r-prove:not([hidden])", { timeout: 15000 });
    },
    holdMs: 10500,
  },
  {
    id: "submit-wise",
    caption: "Step 4 — Submit payment via REAL Wise sandbox",
    narration: "Step four. This is the new piece. We submit the payment via the real Wise sandbox. The S D K makes three live H T T P calls against api dot sandbox dot transferwise dot tech — a quote, a recipient, and a transfer.",
    run: async (page) => {
      await page.click("#btn-submit");
      await page.waitForSelector("#r-submit:not([hidden])", { timeout: 30000 });
    },
    holdMs: 16200,
  },
  {
    id: "wise-result",
    caption: "Real Wise transfer ID returned (provider status: incoming_payment_waiting)",
    narration: "The response shows the real Wise transfer I D returned by the sandbox. Provider status: incoming payment waiting — Wise's documented sandbox state for an unfunded transfer. The S D K's responsibility ends at submitting the funding intent.",
    run: async (page) => { /* hold on the rendered submit result */ },
    holdMs: 16200,
  },
  {
    id: "settle",
    caption: "Step 5 — Settlement Oracle signs Ed25519 attestation",
    narration: "Step five. The settlement oracle verifies the Wise webhook H M A C and emits a canonical Ed twenty five five one nine signed attestation bound to the intent I D. Any downstream consumer verifies with our public key alone.",
    run: async (page) => {
      await page.click("#btn-settle");
      await page.waitForSelector("#r-settle:not([hidden])", { timeout: 10000 });
    },
    holdMs: 15500,
  },
  {
    id: "release-note",
    caption: "Step 6 — RELEASE: operator-signed redeemer spends the escrow",
    narration: "Step six. The operator signs the release redeemer on the Cardano side, spending the escrow U Tx O back to the operator's address. We've shown that path with real Preprod hashes in the testnet evidence — same shape as the lock in step two.",
    run: async (page) => { await page.evaluate(() => window.scrollBy({ top: 200, behavior: "smooth" })); },
    holdMs: 15800,
  },
  {
    id: "outro",
    caption: "v1.0.0 live · MIT · github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments",
    narration: "Full source, the developer docs site, and all test results are public on GitHub under M I T. Version one point zero is tagged and live. Thanks for watching.",
    run: async (page) => { await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })); },
    holdMs: 10500,
  },
];

// ---------- main ----------
async function main() {
  await killExistingOnPort(API_PORT);
  await killExistingOnPort(UI_PORT);

  console.log("[demo] starting backend (sandbox mode, port " + API_PORT + ")");
  spawnBg("node_modules/.bin/tsx", ["backend/api/main.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RAIL_ADAPTER_MODE: "sandbox",
      API_PORT: String(API_PORT),
      OFFRAMP_DATA_DIR: join(repoRoot, "data"),
    },
  });
  await waitForHttp(`${API_URL}/health`, 30_000);
  console.log("[demo] backend healthy");

  console.log("[demo] starting UI server on " + UI_PORT);
  spawnBg("npx", ["--yes", "serve", "ui", "-l", String(UI_PORT)], { cwd: repoRoot });
  await waitForHttp(`http://127.0.0.1:${UI_PORT}/`, 30_000);
  console.log("[demo] UI serving");

  console.log("[demo] launching Chromium with recordVideo");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    recordVideo: { dir: outDir, size: { width: 1280, height: 900 } },
  });
  const page = await context.newPage();

  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#btn-initiate", { timeout: 15000 });
  await page.waitForSelector("#hero-mode", { timeout: 5000 });
  // Make sure the "sandbox" badge is rendered before we start recording the intro.
  await page.waitForFunction(() => {
    const el = document.getElementById("hero-mode");
    return el && /sandbox/i.test(el.textContent ?? "");
  }, null, { timeout: 10000 });

  // No in-page caption overlay — ASS subtitles burned in post-record provide captions.

  // Mark t0 right before the first beat.
  await sleep(800);
  const t0 = Date.now();
  const log = [];

  // No-op caption setter: captions are produced as ASS subtitles by
  // scripts/build-narration.py from beats.json.
  const setCaption = async () => { /* intentionally empty */ };

  for (const beat of beats) {
    const startMs = Date.now() - t0;
    console.log(`[beat] +${startMs}ms ${beat.id} :: ${beat.caption}`);
    await setCaption(beat.caption);
    const actionStart = Date.now();
    try {
      await beat.run(page);
    } catch (e) {
      console.warn(`[beat] action error in ${beat.id}:`, e.message);
    }
    const actionEnd = Date.now();
    const remaining = beat.holdMs - (actionEnd - actionStart);
    if (remaining > 0) await sleep(remaining);
    const endMs = Date.now() - t0;
    log.push({ id: beat.id, startMs, endMs, caption: beat.caption, narration: beat.narration });
  }

  // Final fade — let the closing caption breathe.
  await sleep(800);

  await context.close();
  await browser.close();

  // Save beats.json next to the webm.
  const webms = readdirSync(outDir).filter((f) => f.endsWith(".webm"));
  const meta = { videoFile: webms[0], totalMs: Date.now() - t0, beats: log };
  writeFileSync(join(outDir, "beats.json"), JSON.stringify(meta, null, 2));
  console.log(`[demo] wrote ${join(outDir, "beats.json")}; webm: ${webms[0]}`);
  console.log(`[demo] next: python3 scripts/build-narration.py`);
}

main()
  .then(() => { killAll(); setTimeout(() => process.exit(0), 400); })
  .catch((err) => { console.error(err); killAll(); setTimeout(() => process.exit(1), 400); });

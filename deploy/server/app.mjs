/**
 * PullBG API — one small Express app behind nginx.
 * - POST /api/cut  (multipart, field "image") -> { id }
 * - GET  /api/jobs/:id -> { status, pipeline, guess, createdAt, result?: url }
 * - GET  /api/result/:id.png -> final PNG
 * - GET  /api/health
 * Queue: JSON file per job, one in-process worker (single flight).
 * Quota: 10 images/day per client (localStorage client id + local calendar day), mirroring the site funnel.
 */
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm, unlink, readdir, stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { processImage } from "./worker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_DIR = process.env.PULLBG_JOBS_DIR || "/var/lib/pullbg/jobs";
const RESULT_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const DAILY_LIMIT = 10;

await mkdir(JOBS_DIR, { recursive: true });

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-pullbg-client, x-pullbg-day, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif"]);

function clientKey(req) {
  return req.get("x-pullbg-client") || req.ip || "anon";
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

/** Client local calendar day (minuit local). Reject dates more than ±1 day from UTC. */
function quotaDay(req) {
  const raw = String(req.get("x-pullbg-day") || "").trim();
  const utc = utcDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return utc;
  const t = Date.parse(`${raw}T00:00:00Z`);
  const u = Date.parse(`${utc}T00:00:00Z`);
  if (!Number.isFinite(t) || Math.abs(t - u) > 86400000) return utc;
  return raw;
}

function quotaFile(key) {
  return path.join(JOBS_DIR, `quota-${encodeURIComponent(key)}.json`);
}

async function quotaUsed(key, day) {
  const f = quotaFile(key);
  if (!existsSync(f)) return 0;
  try {
    const q = JSON.parse(await readFile(f, "utf8"));
    return q.day === day ? (q.count | 0) : 0;
  } catch {
    return 0;
  }
}

async function writeQuota(key, day, count) {
  await writeFile(quotaFile(key), JSON.stringify({ day, count }), "utf8");
}

async function bumpQuota(key, day) {
  await writeQuota(key, day, (await quotaUsed(key, day)) + 1);
}

async function refundQuota(key, day) {
  if (!key || !day) return;
  const used = await quotaUsed(key, day);
  if (used <= 0) return;
  await writeQuota(key, day, used - 1);
}

async function saveJob(job) {
  await writeFile(path.join(JOBS_DIR, `${job.id}.json`), JSON.stringify(job), "utf8");
}

async function loadJob(id) {
  const f = path.join(JOBS_DIR, `${id}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(await readFile(f, "utf8"));
  } catch {
    return null;
  }
}

async function workingOn(ids) {
  let current = [];
  try {
    for (const id of ids) {
      const j = await loadJob(id);
      if (j && (j.status === "pending" || j.status === "processing")) current.push(j);
    }
  } catch {}
  return current;
}

app.post("/api/cut", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucune image reçue." });
    if (!ALLOWED.has(req.file.mimetype)) return res.status(415).json({ error: "Format non supporté." });

    const key = clientKey(req);
    const day = quotaDay(req);
    const used = await quotaUsed(key, day);
    if (used >= DAILY_LIMIT) {
      return res.status(429).json({ error: "Limite quotidienne atteinte.", limit: DAILY_LIMIT });
    }

    const id = randomUUID();
    const job = {
      id,
      status: "pending",
      createdAt: Date.now(),
      input: `blob:${id}`,
      result: null,
      error: null,
      client: key,
      day,
    };
    await writeFile(path.join(JOBS_DIR, `${id}.in`), req.file.buffer);
    await saveJob(job);
    await bumpQuota(key, day);
    res.json({ id, status: "pending" });
    kickWorker();
  } catch (e) {
    res.status(500).json({ error: "Erreur interne." });
  }
});

app.get("/api/jobs/:id", async (req, res) => {
  const job = await loadJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Tâche inconnue." });
  res.json({
    id: job.id,
    status: job.status,
    pipeline: job.pipeline ?? null,
    guess: job.guess ?? null,
    createdAt: job.createdAt,
    error: job.error ?? null,
    result: job.status === "done" ? `/api/result/${job.id}.png` : null,
  });
});

app.get("/api/result/:id.png", async (req, res) => {
  const id = req.params.id;
  const job = await loadJob(id);
  if (!job || job.status !== "done") return res.status(404).end();
  const f = path.join(JOBS_DIR, `${id}.out`);
  if (!existsSync(f)) return res.status(404).end();
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Disposition", `attachment; filename="pullbg-${id.slice(0, 8)}.png"`);
  res.sendFile(f);
});

app.get("/api/health", (_req, res) => res.json({ ok: true, jobs: jobsDirCount() }));

function jobsDirCount() {
  try {
    return readdirSync(JOBS_DIR).filter((x) => x.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

// ---------- worker (single flight) ----------
let running = false;
let wake = false;

/** Test seam: awaited after an empty scan, before the wake re-check. */
export const queueHooks = { afterIdleScan: null };

async function pendingJobs() {
  const ids = (await readdir(JOBS_DIR))
    .filter((x) => x.endsWith(".json") && !x.startsWith("quota-"))
    .map((x) => x.replace(/\.json$/, ""));
  // Single-flight: any "processing" job we see here is leftover from a crash.
  return (await workingOn(ids))
    .filter((j) => j.status === "pending" || j.status === "processing")
    .sort((a, b) => a.createdAt - b.createdAt);
}

async function runJob(job) {
  job.status = "processing";
  await saveJob(job);
  try {
    const input = await readFile(path.join(JOBS_DIR, `${job.id}.in`));
    const out = await processImage(input);
    await writeFile(path.join(JOBS_DIR, `${job.id}.out`), out.buffer);
    job.status = "done";
    job.pipeline = out.pipeline;
    job.guess = out.guess;
    job.finishedAt = Date.now();
    await saveJob(job);
  } catch (e) {
    job.status = "error";
    job.error = String(e?.message || e);
    await saveJob(job);
    await refundQuota(job.client, job.day);
  }
  await unlink(path.join(JOBS_DIR, `${job.id}.in`)).catch(() => {});
}

export async function kickWorker() {
  wake = true;
  if (running) return;
  running = true;
  try {
    while (wake) {
      wake = false;
      for (;;) {
        const pending = await pendingJobs();
        if (pending.length === 0) break;
        await runJob(pending[0]);
      }
      if (queueHooks.afterIdleScan) await queueHooks.afterIdleScan();
    }
  } finally {
    running = false;
  }
  if (wake) void kickWorker();
}

// daily cleanup of old results
setInterval(async () => {
  try {
    for (const f of await readdir(JOBS_DIR)) {
      if (f.endsWith(".in")) {
        const json = path.join(JOBS_DIR, f.replace(/\.in$/, ".json"));
        if (!existsSync(json)) await rm(path.join(JOBS_DIR, f), { force: true });
        continue;
      }
      if (!f.endsWith(".json")) continue;
      const p = path.join(JOBS_DIR, f);
      const st = await stat(p);
      if (Date.now() - st.mtimeMs > RESULT_TTL_MS) {
        const id = f.replace(/\.json$/, "");
        await rm(p, { force: true });
        await rm(path.join(JOBS_DIR, `${id}.out`), { force: true });
        await rm(path.join(JOBS_DIR, `${id}.in`), { force: true });
      }
    }
  } catch {}
}, 60 * 60 * 1000).unref();

export { app };

const PORT = process.env.PORT || 8080;
if (process.env.PULLBG_NO_LISTEN !== "1") {
  app.listen(PORT, () => {
    console.log(`PullBG API on :${PORT}`);
    kickWorker();
  });
}
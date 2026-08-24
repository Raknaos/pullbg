/** A job saved while the worker is about to idle must still run. */
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ImageData } = require("@napi-rs/canvas");
globalThis.ImageData = globalThis.ImageData ?? ImageData;

const JOBS = path.join(process.env.LOCALAPPDATA || ".", "Temp", "pullbg-queue-test");
process.env.PULLBG_NO_LISTEN = "1";
process.env.PULLBG_JOBS_DIR = JOBS;

await rm(JOBS, { recursive: true, force: true });
await mkdir(JOBS, { recursive: true });

const { kickWorker, queueHooks } = await import("./app.mjs");
const { encodePng } = await import("./worker.mjs");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function studioPng() {
  const image = new ImageData(80, 48);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 0;
    d[i + 1] = 180;
    d[i + 2] = 60;
    d[i + 3] = 255;
  }
  for (let y = 12; y < 36; y++) {
    for (let x = 24; x < 56; x++) {
      const i = (y * 80 + x) * 4;
      d[i] = 200;
      d[i + 1] = 40;
      d[i + 2] = 40;
    }
  }
  return encodePng(image);
}

async function writeJob(id, createdAt) {
  const job = {
    id,
    status: "pending",
    createdAt,
    input: `blob:${id}`,
    result: null,
    error: null,
  };
  await writeFile(path.join(JOBS, `${id}.in`), studioPng());
  await writeFile(path.join(JOBS, `${id}.json`), JSON.stringify(job), "utf8");
}

async function load(id) {
  return JSON.parse(await readFile(path.join(JOBS, `${id}.json`), "utf8"));
}

{
  await writeJob("first", 1);
  let injected = false;
  queueHooks.afterIdleScan = async () => {
    if (injected) return;
    injected = true;
    await writeJob("late", 2);
    await kickWorker();
  };
  await kickWorker();
  queueHooks.afterIdleScan = null;

  const first = await load("first");
  const late = await load("late");
  assert(first.status === "done", `first job stuck (${first.status} ${first.error || ""})`);
  assert(late.status === "done", `late job stuck (${late.status} ${late.error || ""})`);
  assert(existsSync(path.join(JOBS, "first.out")), "first result written");
  assert(existsSync(path.join(JOBS, "late.out")), "late result written");
  assert(!existsSync(path.join(JOBS, "first.in")), "first input released");
  assert(!existsSync(path.join(JOBS, "late.in")), "late input released");
}

await rm(JOBS, { recursive: true, force: true });
console.log("queue wake: late job after idle scan still runs");

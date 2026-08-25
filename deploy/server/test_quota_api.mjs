/** Server quota: local day from the client, refund when a cut fails. */
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ImageData } = require("@napi-rs/canvas");
globalThis.ImageData = globalThis.ImageData ?? ImageData;

const JOBS = path.join(process.env.LOCALAPPDATA || ".", "Temp", "pullbg-quota-test");
process.env.PULLBG_NO_LISTEN = "1";
process.env.PULLBG_JOBS_DIR = JOBS;

await rm(JOBS, { recursive: true, force: true });
await mkdir(JOBS, { recursive: true });

const { app } = await import("./app.mjs");
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

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const png = studioPng();

async function postCut(buf, { client, day, type } = {}) {
  const fd = new FormData();
  fd.append("image", new Blob([buf], { type: type || "image/png" }), "x.png");
  const headers = {};
  if (client) headers["x-pullbg-client"] = client;
  if (day) headers["x-pullbg-day"] = day;
  return fetch(`${base}/api/cut`, { method: "POST", body: fd, headers });
}

async function waitJob(id) {
  const deadline = Date.now() + 20000;
  let last = "";
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/jobs/${id}`);
    last = `${res.status} ${await res.text()}`;
    if (res.ok) {
      const info = JSON.parse(last.slice(last.indexOf(" ") + 1));
      if (info.status === "done" || info.status === "error") return info;
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`job ${id} timed out (${last})`);
}

async function quotaCount(client) {
  const f = path.join(JOBS, `quota-${encodeURIComponent(client)}.json`);
  try {
    return JSON.parse(await readFile(f, "utf8"));
  } catch {
    return { day: null, count: 0 };
  }
}

{
  const pre = await fetch(`${base}/api/cut`, { method: "OPTIONS" });
  assert(pre.status === 204, `CORS preflight ${pre.status}`);
  const allow = pre.headers.get("access-control-allow-headers") || "";
  assert(allow.includes("x-pullbg-day"), `CORS allows local day header (${allow})`);
}

{
  const day = new Date().toISOString().slice(0, 10);
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const client = "local-day";
  for (let i = 0; i < 9; i++) {
    const res = await postCut(png, { client, day });
    assert(res.status === 200, `cut ${i + 1} accepted (${res.status})`);
    const { id } = await res.json();
    const info = await waitJob(id);
    assert(info.status === "done", `cut ${i + 1} done (${info.status} ${info.error || ""})`);
  }

  const bad = await postCut(Buffer.from("not-an-image"), { client, day });
  assert(bad.status === 200, "corrupt image is accepted then refunded");
  const badInfo = await waitJob((await bad.json()).id);
  assert(badInfo.status === "error", `corrupt image fails (${badInfo.status})`);
  const afterFail = await quotaCount(client);
  assert(afterFail.day === day, `quota stays on local day (${afterFail.day})`);
  assert(afterFail.count === 9, `failed cut refunds quota, got ${afterFail.count}`);

  const tenth = await postCut(png, { client, day });
  assert(tenth.status === 200, "refunded slot can be reused");
  const tenthInfo = await waitJob((await tenth.json()).id);
  assert(tenthInfo.status === "done", `tenth cut done (${tenthInfo.status})`);

  const blocked = await postCut(png, { client, day });
  assert(blocked.status === 429, `11th same local day is 429, got ${blocked.status}`);

  const spoof = await postCut(png, { client, day: "2020-01-01" });
  assert(spoof.status === 429, "far-away day header is ignored, still 429 on current lot");

  const next = await postCut(png, { client, day: nextDay });
  assert(next.status === 200, "next local day starts a new lot");
  const nextInfo = await waitJob((await next.json()).id);
  assert(nextInfo.status === "done", `next-day cut done (${nextInfo.status})`);
}

server.close();
await rm(JOBS, { recursive: true, force: true });
console.log("quota api: local day + refund on failed cut OK");

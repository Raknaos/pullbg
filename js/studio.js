import {
  consumeOne,
  refundOne,
  canCut,
  quota,
  quotaLabel,
  paintNav,
  nextResetAt,
  formatCountdown,
  paidBatchSize,
} from "./auth.js?v=57";
import { warmup, fastCut, refineCut } from "../lib/engine.js?v=93";
import {
  bitmapFromSource,
  imageDataFromBitmap,
  blobFromImageData,
  blobFromImageDataBlurred,
} from "../lib/cutout.js?v=93";

paintNav();
warmup();

const stage = document.getElementById("stage");
const empty = document.getElementById("empty");
const preview = document.getElementById("preview");
const resultImg = document.getElementById("result");
const fileInput = document.getElementById("file");
const queueEl = document.getElementById("queue");
const quotaEl = document.getElementById("quota");
const quotaSide = document.getElementById("quota-side");
const zipBtn = document.getElementById("zip");
const clearBtn = document.getElementById("clear");
const dl = document.getElementById("dl");
const gate = document.getElementById("gate");
const gateText = document.getElementById("gate-text");
const gateCta = document.getElementById("gate-cta");

let jobs = [];
let selectedId = null;
let running = false;

function refreshQuota() {
  const label = quotaLabel(quota());
  if (quotaEl) quotaEl.textContent = label;
  if (quotaSide) quotaSide.textContent = label;
}
refreshQuota();
setInterval(refreshQuota, 30000);

function openGate(kind) {
  if (kind === "account") {
    gateText.textContent = "Crée un compte pour continuer.";
    gateCta.textContent = "Créer un compte";
    gateCta.href = "./login.html?next=pricing";
  } else {
    gateText.textContent = `Lot du jour terminé. Nouveau lot dans ${formatCountdown(nextResetAt() - Date.now())}.`;
    gateCta.textContent = "Voir les offres";
    gateCta.href = "./pricing.html";
  }
  gate.hidden = false;
}
document.getElementById("gate-close").addEventListener("click", () => { gate.hidden = true; });
window.addEventListener("keydown", (e) => { if (e.key === "Escape") gate.hidden = true; });

stage.addEventListener("click", (e) => {
  if (e.target.closest("#preview")) return;
  fileInput.click();
});
fileInput.addEventListener("change", () => addFiles(fileInput.files));
document.body.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("over"); });
document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  stage.classList.remove("over");
  addFiles(e.dataTransfer.files);
});
window.addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.files;
  if (items && items.length) addFiles(items);
});

function forgetUrl(u) {
  if (u && String(u).startsWith("blob:")) URL.revokeObjectURL(u);
}

function addFiles(list) {
  let added = 0;
  for (const file of list) {
    if (!file.type.startsWith("image/")) continue;
    const job = {
      id: crypto.randomUUID(),
      file,
      name: file.name,
      url: URL.createObjectURL(file),
      status: "en file",
      result: null,
      blob: null,
      locked: false,
      draft: null,
    };
    jobs.push(job);
    selectedId = job.id;
    added++;
  }
  if (!added) return;
  fileInput.value = "";
  render();
  if (!running) processQueue();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function selected() {
  return jobs.find((j) => j.id === selectedId) || jobs[jobs.length - 1] || null;
}

function showStage(job) {
  if (!job) {
    empty.hidden = false;
    preview.hidden = true;
    dl.hidden = true;
    return;
  }
  empty.hidden = true;
  preview.hidden = false;
  resultImg.src = job.result || job.url;
  if (job.result && !job.locked) {
    dl.hidden = false;
    dl.href = job.result;
    dl.download = job.name.replace(/\.[^.]+$/, "") + ".png";
  } else {
    dl.hidden = true;
  }
}

function render() {
  const pending = jobs.filter((j) => j.status === "en file" || j.status === "découpe…" || j.status === "affinage…").length;
  const note = empty && empty.querySelector(".note");
  if (note) note.textContent = pending ? `${pending} en cours — tu peux en ajouter` : "plusieurs images d’un coup";
  queueEl.innerHTML = "";
  let has = false;
  for (const job of jobs) {
    if (job.result && !job.locked) has = true;
    const el = document.createElement("article");
    el.className = "job" + (job.id === selectedId ? " on" : "") + (job.locked ? " locked" : "");
    el.dataset.id = job.id;
    el.innerHTML = `
      <div class="thumb checker">
        <img alt="" src="${job.result || job.url}" />
        ${job.locked ? `<div class="lock">bloqué</div>` : ""}
      </div>
      <div>
        <strong>${esc(job.name)}</strong>
        <div class="status ${job.status === "prêt" ? "ok" : job.status.startsWith("erreur") || job.locked ? "err" : ""}">${esc(job.status)}</div>
      </div>`;
    el.addEventListener("click", () => { selectedId = job.id; render(); });
    queueEl.appendChild(el);
  }
  zipBtn.hidden = !has;
  clearBtn.hidden = jobs.length === 0;
  showStage(selected());
}

function patchJob(job) {
  const el = queueEl.querySelector(`[data-id="${job.id}"]`);
  if (!el) {
    render();
    return;
  }
  const img = el.querySelector("img");
  if (img) img.src = job.result || job.url;
  const st = el.querySelector(".status");
  if (st) {
    st.textContent = job.status;
    st.className = "status " + (job.status === "prêt" ? "ok" : job.status.startsWith("erreur") || job.locked ? "err" : "");
  }
  el.classList.toggle("locked", job.locked);
  zipBtn.hidden = !jobs.some((j) => j.result && !j.locked);
  if (job.id === selectedId) showStage(job);
}

queueEl.addEventListener("click", (e) => {
  const id = e.target.dataset.del;
  if (!id) return;
  const job = jobs.find((j) => j.id === id);
  if (job) {
    forgetUrl(job.url);
    forgetUrl(job.result);
  }
  jobs = jobs.filter((j) => j.id !== id);
  if (selectedId === id) selectedId = jobs[0] ? jobs[0].id : null;
  render();
});
clearBtn.addEventListener("click", () => {
  for (const job of jobs) {
    forgetUrl(job.url);
    forgetUrl(job.result);
  }
  jobs = [];
  selectedId = null;
  render();
});
zipBtn.addEventListener("click", downloadZip);

function dropPixels(job) {
  job.source = null;
  if (job.draft) job.draft = { needsRefine: false, pipeline: job.draft.pipeline };
}

async function show(job, image, locked) {
  const prev = job.result;
  if (locked) {
    job.blob = null;
    job.result = URL.createObjectURL(await blobFromImageDataBlurred(image));
  } else {
    job.blob = await blobFromImageData(image);
    job.result = URL.createObjectURL(job.blob);
  }
  if (prev && prev !== job.result) forgetUrl(prev);
}

async function cutOne(job, locked) {
  selectedId = job.id;
  job.status = "découpe…";
  patchJob(job);
  try {
    const original = imageDataFromBitmap(await bitmapFromSource(job.file), 2200).image;
    job.source = original;
    job.draft = fastCut(original);
    await show(job, job.draft.image, locked);
    job.status = locked ? "aperçu flou" : (job.draft.needsRefine ? "affinage…" : "prêt");
    job.locked = locked;
    if (locked || !job.draft.needsRefine) dropPixels(job);
    patchJob(job);
  } catch (err) {
    dropPixels(job);
    throw err;
  }
}

async function processQueue() {
  running = true;
  try {
    while (true) {
      const pending = jobs.filter((j) => !j.draft && !j.locked && !j.status.startsWith("erreur"));
      if (!pending.length) break;
      const gateState = canCut();
      if (!gateState.ok) {
        try {
          await cutOne(pending[0], true);
        } catch (err) {
          pending[0].status = "erreur : " + (err.message || err);
          pending[0].locked = true;
          patchJob(pending[0]);
        }
        openGate(gateState.gate);
        break;
      }
      const n = paidBatchSize(gateState.q.remaining, pending.length);
      const batch = pending.slice(0, n);
      for (const job of batch) consumeOne();
      refreshQuota();
      await Promise.all(batch.map((job) => cutOne(job, false).catch((err) => {
        refundOne();
        refreshQuota();
        if (err && err.gate) {
          job.locked = true;
          job.status = "verrouillé";
          openGate(err.gate);
          return;
        }
        job.status = "erreur : " + (err.message || err);
        patchJob(job);
      })));
    }
    for (const job of jobs) {
      if (!job.draft || !job.draft.needsRefine || job.locked) continue;
      try {
        job.status = "affinage…";
        patchJob(job);
        const better = await refineCut(job.file, job.draft, job.source);
        job.draft = better;
        await show(job, better.image, false);
        dropPixels(job);
        job.status = "prêt";
        patchJob(job);
      } catch {
        dropPixels(job);
        job.status = "prêt";
        patchJob(job);
      }
    }
  } finally {
    running = false;
    refreshQuota();
    if (jobs.some((j) => j.status === "en file")) processQueue();
  }
}

function zipName(name, used) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  let file = `${base}.png`;
  let n = 2;
  while (used.has(file)) {
    file = `${base}-${n}.png`;
    n++;
  }
  used.add(file);
  return file;
}

async function downloadZip() {
  const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
  const zip = new JSZip();
  const used = new Set();
  for (const job of jobs) if (job.blob && !job.locked) zip.file(zipName(job.name, used), job.blob);
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = "pullbg.zip";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

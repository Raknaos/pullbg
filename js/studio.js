import {
  consumeOne,
  canCut,
  quota,
  quotaLabel,
  paintNav,
  nextResetAt,
  formatCountdown,
} from "./auth.js";
import { warmup, fastCut, refineCut } from "../lib/engine.js";
import {
  bitmapFromSource,
  imageDataFromBitmap,
  blobFromImageData,
  blobFromImageDataBlurred,
} from "../lib/cutout.js";

paintNav();
warmup();

const drop = document.getElementById("drop");
const fileInput = document.getElementById("file");
const queueEl = document.getElementById("queue");
const quotaEl = document.getElementById("quota");
const zipBtn = document.getElementById("zip");
const clearBtn = document.getElementById("clear");
const gate = document.getElementById("gate");
const gateText = document.getElementById("gate-text");
const gateCta = document.getElementById("gate-cta");

let jobs = [];
let running = false;

function refreshQuota() {
  if (quotaEl) quotaEl.textContent = quotaLabel(quota());
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

drop.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => addFiles(fileInput.files));
document.body.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
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
    jobs.push({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      url: URL.createObjectURL(file),
      status: "en file",
      result: null,
      blob: null,
      locked: false,
      draft: null,
    });
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

function render() {
  const pending = jobs.filter((j) => j.status === "en file" || j.status === "découpe…" || j.status === "affinage…").length;
  const note = drop.querySelector(".note");
  if (note) note.textContent = pending ? `${pending} en cours — tu peux en ajouter` : "ou clique · Ctrl+V";
  queueEl.innerHTML = "";
  let has = false;
  for (const job of jobs) {
    if (job.result && !job.locked) has = true;
    const el = document.createElement("article");
    el.className = "job" + (job.locked ? " locked" : "");
    el.dataset.id = job.id;
    const dl = job.result && !job.locked
      ? `<a class="btn btn-acc" download="${job.name.replace(/\.[^.]+$/, "")}.png" href="${job.result}">PNG</a>`
      : "";
    el.innerHTML = `
      <div class="thumb checker">
        <img alt="" src="${job.result || job.url}" />
        ${job.locked ? `<div class="lock">bloqué</div>` : ""}
      </div>
      <div>
        <strong>${esc(job.name)}</strong>
        <div class="status ${job.status === "prêt" ? "ok" : job.status.startsWith("erreur") || job.locked ? "err" : ""}">${esc(job.status)}</div>
      </div>
      <div class="hero-cta">
        ${dl}
        <button class="btn btn-ghost" data-del="${job.id}">Retirer</button>
      </div>`;
    queueEl.appendChild(el);
  }
  zipBtn.hidden = !has;
  clearBtn.hidden = jobs.length === 0;
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
  const actions = el.querySelector(".hero-cta");
  if (actions && job.result && !job.locked && !actions.querySelector("[download]")) {
    const a = document.createElement("a");
    a.className = "btn btn-acc";
    a.download = job.name.replace(/\.[^.]+$/, "") + ".png";
    a.href = job.result;
    a.textContent = "PNG";
    actions.prepend(a);
  }
  zipBtn.hidden = !jobs.some((j) => j.result && !j.locked);
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
  render();
});
clearBtn.addEventListener("click", () => {
  for (const job of jobs) {
    forgetUrl(job.url);
    forgetUrl(job.result);
  }
  jobs = [];
  render();
});
zipBtn.addEventListener("click", downloadZip);

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
  job.status = "découpe…";
  patchJob(job);
  const original = imageDataFromBitmap(await bitmapFromSource(job.file)).image;
  job.draft = fastCut(original);
  await show(job, job.draft.image, locked);
  job.status = locked ? "aperçu flou" : (job.draft.needsRefine ? "affinage…" : "prêt");
  job.locked = locked;
  patchJob(job);
}

async function processQueue() {
  running = true;
  try {
    while (true) {
      const pending = jobs.filter((j) => !j.draft && !j.locked && !j.status.startsWith("erreur"));
      if (!pending.length) break;
      const batch = [];
      for (const job of pending) {
        if (batch.length >= 3) break;
        const gateState = canCut();
        if (!gateState.ok) {
          try {
            await cutOne(job, true);
          } catch (err) {
            job.status = "erreur : " + (err.message || err);
            job.locked = true;
            patchJob(job);
          }
          openGate(gateState.gate);
          return;
        }
        consumeOne();
        refreshQuota();
        batch.push(job);
      }
      await Promise.all(batch.map((job) => cutOne(job, false).catch((err) => {
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
        const better = await refineCut(job.file, job.draft);
        job.draft = better;
        await show(job, better.image, false);
        job.status = "prêt";
        patchJob(job);
      } catch {
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

async function downloadZip() {
  const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
  const zip = new JSZip();
  for (const job of jobs) if (job.blob && !job.locked) zip.file(job.name.replace(/\.[^.]+$/, "") + ".png", job.blob);
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pullbg.zip";
  a.click();
}

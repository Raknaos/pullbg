import {
  consumeOne,
  canCut,
  quota,
  quotaLabel,
  paintNav,
  nextResetAt,
  formatCountdown,
} from "./auth.js";
import { smartCut } from "../lib/engine.js";
import { blobFromImageData, blobFromImageDataBlurred } from "../lib/cutout.js";

paintNav();

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
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  addFiles(e.dataTransfer.files);
});
window.addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.files;
  if (items && items.length) addFiles(items);
});

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
    });
    added++;
  }
  if (!added) return;
  render();
  if (!running) processQueue();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function render() {
  queueEl.innerHTML = "";
  let has = false;
  for (const job of jobs) {
    if (job.result && !job.locked) has = true;
    const el = document.createElement("article");
    el.className = "job" + (job.locked ? " locked" : "");
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

queueEl.addEventListener("click", (e) => {
  const id = e.target.dataset.del;
  if (!id) return;
  jobs = jobs.filter((j) => j.id !== id);
  render();
});
clearBtn.addEventListener("click", () => { jobs = []; render(); });
zipBtn.addEventListener("click", downloadZip);

async function processQueue() {
  running = true;
  try {
    for (const job of jobs) {
      if (job.result || job.status.startsWith("erreur")) continue;
      const gateState = canCut();
      if (!gateState.ok) {
        job.locked = true;
        job.status = "verrouillé";
        render();
        try {
          const cut = await smartCut(job.file, { mode: "auto", onStatus: (s) => { job.status = s; render(); } });
          job.result = URL.createObjectURL(await blobFromImageDataBlurred(cut.image));
          job.status = "aperçu flou";
        } catch (err) {
          job.status = "erreur : " + (err.message || err);
        }
        render();
        openGate(gateState.gate);
        break;
      }
      try {
        consumeOne();
        refreshQuota();
        job.status = "découpe…";
        render();
        const cut = await smartCut(job.file, { mode: "auto", onStatus: (s) => { job.status = s; render(); } });
        job.blob = await blobFromImageData(cut.image);
        job.result = URL.createObjectURL(job.blob);
        job.status = "prêt";
      } catch (err) {
        if (err && err.gate) {
          job.locked = true;
          job.status = "verrouillé";
          openGate(err.gate);
        } else {
          job.status = "erreur : " + (err.message || err);
        }
      }
      render();
    }
  } finally {
    running = false;
    refreshQuota();
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

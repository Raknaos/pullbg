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

const stage = document.getElementById("stage");
const empty = document.getElementById("empty");
const cmp = document.getElementById("cmp");
const before = document.getElementById("before");
const after = document.getElementById("after");
const split = document.getElementById("split");
const fileInput = document.getElementById("file");
const queueEl = document.getElementById("queue");
const quotaEl = document.getElementById("quota");
const quotaSide = document.getElementById("quota-side");
const zipBtn = document.getElementById("zip");
const clearBtn = document.getElementById("clear");
const interiorBtn = document.getElementById("interior");
const qaBtn = document.getElementById("qa");
const dl = document.getElementById("dl");
const gate = document.getElementById("gate");
const gateText = document.getElementById("gate-text");
const gateCta = document.getElementById("gate-cta");

let mode = "auto";
let interior = false;
let jobs = [];
let selectedId = null;
let running = false;

function refreshQuota() {
  const label = quotaLabel(quota());
  quotaEl.textContent = label;
  quotaSide.textContent = label;
}
refreshQuota();
setInterval(refreshQuota, 30000);

function openGate(kind) {
  if (kind === "account") {
    gateText.textContent = "Crée un compte pour continuer. Ensuite tu verras les offres.";
    gateCta.textContent = "Créer un compte";
    gateCta.href = "./login.html?next=pricing";
  } else {
    gateText.textContent = `Lot du jour terminé. Nouveau lot dans ${formatCountdown(nextResetAt() - Date.now())}, ou PullBG+.`;
    gateCta.textContent = "Voir les offres";
    gateCta.href = "./pricing.html";
  }
  gate.hidden = false;
}
document.getElementById("gate-close").addEventListener("click", () => { gate.hidden = true; });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") gate.hidden = true;
  if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    jobs = jobs.filter((j) => j.id !== selectedId);
    selectedId = jobs[0] ? jobs[0].id : null;
    render();
  }
});

document.getElementById("modes").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  mode = btn.dataset.mode;
  for (const b of document.querySelectorAll("#modes button")) b.classList.toggle("on", b === btn);
});
interiorBtn.addEventListener("click", () => {
  interior = !interior;
  interiorBtn.classList.toggle("on", interior);
});
qaBtn.addEventListener("click", () => {
  const on = !stage.classList.contains("qa");
  stage.classList.toggle("qa", on);
  qaBtn.classList.toggle("on", on);
});

stage.addEventListener("click", (e) => {
  if (e.target.closest("#cmp")) return;
  fileInput.click();
});
fileInput.addEventListener("change", () => addFiles(fileInput.files));
stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("over"); });
stage.addEventListener("dragleave", () => stage.classList.remove("over"));
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  stage.classList.remove("over");
  addFiles(e.dataTransfer.files);
});
window.addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.files;
  if (items && items.length) addFiles(items);
});
split.addEventListener("input", () => {
  cmp.style.setProperty("--pos", split.value + "%");
});
cmp.style.setProperty("--pos", "50%");

function addFiles(list) {
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
      detected: "",
    };
    jobs.push(job);
    selectedId = job.id;
  }
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
    cmp.hidden = true;
    stage.classList.add("empty");
    dl.hidden = true;
    return;
  }
  empty.hidden = true;
  cmp.hidden = false;
  stage.classList.remove("empty");
  before.src = job.url;
  after.src = job.result || job.url;
  if (job.result && !job.locked) {
    dl.hidden = false;
    dl.href = job.result;
    dl.download = job.name.replace(/\.[^.]+$/, "") + ".png";
  } else {
    dl.hidden = true;
  }
}

function render() {
  queueEl.innerHTML = "";
  let has = false;
  for (const job of jobs) {
    if (job.result && !job.locked) has = true;
    const el = document.createElement("article");
    el.className = "job" + (job.id === selectedId ? " on" : "");
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
  showStage(selected());
}

queueEl.addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (!del) return;
});
clearBtn.addEventListener("click", () => { jobs = []; selectedId = null; render(); });
zipBtn.addEventListener("click", downloadZip);

async function processQueue() {
  running = true;
  try {
    for (const job of jobs) {
      if (job.result || job.status.startsWith("erreur")) continue;
      selectedId = job.id;
      const gateState = canCut();
      const locked = !gateState.ok;
      if (locked) {
        job.status = "verrouillé";
        job.locked = true;
        render();
        try {
          const cut = await smartCut(job.file, {
            mode,
            interior,
            onStatus: (s) => { job.detected = s; job.status = s; render(); },
          });
          const blur = await blobFromImageDataBlurred(cut.image);
          job.blob = null;
          job.result = URL.createObjectURL(blur);
          job.status = "aperçu flou";
        } catch (err) {
          job.status = "erreur : " + (err && err.message ? err.message : String(err));
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
        const cut = await smartCut(job.file, {
          mode,
          interior,
          onStatus: (s) => { job.detected = s; job.status = s; render(); },
        });
        const out = await blobFromImageData(cut.image);
        job.blob = out;
        job.result = URL.createObjectURL(out);
        job.detected = `${cut.guess.kind} · ${cut.pipeline}`;
        job.status = "prêt";
      } catch (err) {
        if (err && err.gate) {
          job.locked = true;
          job.status = "verrouillé";
          openGate(err.gate);
        } else {
          job.status = "erreur : " + (err && err.message ? err.message : String(err));
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

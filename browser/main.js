import {
  parsePdf,
  parseCoordinateInput,
  validateBrazilBounds,
  calculateCoordinates,
  buildKml,
  packageKmz,
  mergeOptions,
  CALC_PIPELINE_ID,
} from "../parser/pdf-parser.js";
import {
  calculateCoordinatesWithDwg,
  formatDwgWarning,
} from "../parser/dwg/coordinate-calculator-dwg.js";
import { createRegionLibrary } from "../parser/dwg/region-library.js";
import { createDefaultHybridRegionLibrary } from "../parser/dwg/region-library-hybrid.js";
import { PRESET_COLORS, DEFAULT_OPTIONS } from "../parser/kmz-defaults.js";
import {
  computeScaleFactor,
  buildPageTransforms,
} from "../parser/geo/utm-calibrator.js";

const regionLibrary = createDefaultHybridRegionLibrary(createRegionLibrary());

// ── Debug helpers ──────────────────────────────────────────────────────────
const debugSection = document.getElementById("debugSection");
const debugOutput = document.getElementById("debugOutput");

function showDebug(text) {
  debugOutput.textContent = text;
}

function dumpCalibrationData(parseResult) {
  const lines = [];
  lines.push(
    "══ PARSE DEBUG DUMP ══════════════════════════════════════════════════",
  );

  // Posts
  lines.push(`\nPosts found: ${parseResult.posts.length}`);
  for (const p of parseResult.posts) {
    const ax = p.anchorX != null ? p.anchorX.toFixed(2) : "—";
    const ay = p.anchorY != null ? p.anchorY.toFixed(2) : "—";
    lines.push(
      `  Post ${String(p.number).padStart(2, "0")}: page=${p.pageNum ?? "?"}  x=${p.x != null ? p.x.toFixed(2) : "?"}  y=${p.y != null ? p.y.toFixed(2) : "?"}  anchor=(${ax},${ay})  type=${p.postType ?? "—"}`,
    );
  }

  // Page dimensions
  lines.push(`\nPage dimensions (w × h in PDF points):`);
  if (parseResult.pageDimensions instanceof Map) {
    for (const [pn, dim] of parseResult.pageDimensions) {
      lines.push(`  Page ${pn}: ${dim.w.toFixed(2)} × ${dim.h.toFixed(2)} pt`);
    }
  } else {
    lines.push("  pageDimensions is not a Map — empty or missing");
  }

  // UTM grid paths per page
  lines.push(`\nUTM grid paths per page (isUtmGridLayerName hits):`);
  if (parseResult.utmGridPathsPerPage instanceof Map) {
    for (const [pn, paths] of parseResult.utmGridPathsPerPage) {
      lines.push(
        `  Page ${pn}: ${paths.length} path(s)  total ops=${paths.reduce((s, p) => s + p.length, 0)}`,
      );
    }
    if (parseResult.utmGridPathsPerPage.size === 0) {
      lines.push(
        "  (none found — UTM layer may be named differently or absent)",
      );
    }
  } else {
    lines.push("  utmGridPathsPerPage is not a Map");
  }

  // Scale factor (live computation)
  lines.push(`\nScale factor computation:`);
  const warnings = [];
  let scaleFactor = null;
  if (parseResult.utmGridPathsPerPage instanceof Map) {
    const page2Paths = parseResult.utmGridPathsPerPage.get(2) ?? [];
    scaleFactor = computeScaleFactor(page2Paths, warnings);
    lines.push(`  Page 2 UTM paths: ${page2Paths.length}`);
    lines.push(
      `  computeScaleFactor(page2) → ${scaleFactor !== null ? scaleFactor.toFixed(6) + " m/pt" : "null (not found)"}`,
    );
    if (scaleFactor === null) {
      for (const [pn, paths] of parseResult.utmGridPathsPerPage) {
        if (pn === 2) continue;
        const sf = computeScaleFactor(paths, warnings);
        lines.push(
          `  computeScaleFactor(page ${pn}) → ${sf !== null ? sf.toFixed(6) + " m/pt" : "null"}`,
        );
        if (sf !== null && scaleFactor === null) scaleFactor = sf;
      }
    }
    if (scaleFactor !== null) {
      lines.push(`  → Using scale factor: ${scaleFactor.toFixed(6)} m/pt`);
      lines.push(
        `  → Implied 50m UTM grid spacing: ${(50 / scaleFactor).toFixed(1)} PDF points`,
      );
    } else {
      lines.push(`  → NO scale factor found — all posts will get lat: null`);
    }
    if (warnings.length > 0) {
      for (const w of warnings) lines.push(`  [warn] ${w}`);
    }
  }

  // Viewport boxes (paired)
  lines.push(`\nViewport boxes (paired from page-2 Padrão layer):`);
  if (Array.isArray(parseResult.viewportBoxes)) {
    lines.push(`  Count: ${parseResult.viewportBoxes.length}`);
    for (const v of parseResult.viewportBoxes) {
      const r = v.rect;
      lines.push(
        `  pageNum=${v.pageNum}  x=${r.x.toFixed(1)}  y=${r.y.toFixed(1)}  w=${r.w.toFixed(1)}  h=${r.h.toFixed(1)}`,
      );
    }
    if (parseResult.viewportBoxes.length === 0) {
      lines.push("  (none found — Padrão layer rects may not be extractable)");
    }
  } else {
    lines.push("  viewportBoxes is not an array");
  }

  lines.push(
    "\n══ END DUMP ══════════════════════════════════════════════════════════",
  );
  return lines.join("\n");
}

const pdfInput = document.getElementById("pdfInput");
const uploadSection = document.getElementById("uploadSection");
const uploadZone = document.getElementById("uploadZone");
const uploadSelected = document.getElementById("uploadSelected");
const uploadFileName = document.getElementById("uploadFileName");
const browsePdfBtn = document.getElementById("browsePdfBtn");
const changeFileBtn = document.getElementById("changeFileBtn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const summaryList = document.getElementById("summaryList");
const warningsEl = document.getElementById("warnings");
const warningsList = document.getElementById("warningsList");
const coordForm = document.getElementById("coordForm");
const gpsInput = document.getElementById("gpsInput");
const gpsInputLast = document.getElementById("gpsInputLast");
const calcBtn = document.getElementById("calcBtn");
const dxfUploadBtn = document.getElementById("dxfUploadBtn");
const dxfFileInput = document.getElementById("dxfFileInput");
const dxfRegionName = document.getElementById("dxfRegionName");
const dxfRegionSelect = document.getElementById("dxfRegionSelect");
const dxfUploadStatus = document.getElementById("dxfUploadStatus");
const dxfCloudStatus = document.getElementById("dxfCloudStatus");
const coordWarning = document.getElementById("coordWarning");
const secondAnchorToggle = document.getElementById("secondAnchorToggle");
const secondAnchorPanel = document.getElementById("secondAnchorPanel");
const lineWidthSelect = document.getElementById("lineWidthSelect");
const labelScaleSelect = document.getElementById("labelScaleSelect");
const lineDescriptionInput = document.getElementById("lineDescriptionInput");
const kmzFilenameInput = document.getElementById("kmzFilenameInput");
const resultSection = document.getElementById("resultSection");
const outputPreview = document.getElementById("outputPreview");
const downloadKmzBtn = document.getElementById("downloadKmzBtn");
const downloadKmzHint = document.getElementById("downloadKmzHint");
const kmzStats = document.getElementById("kmzStats");
const kmzStatsBody = document.getElementById("kmzStatsBody");
const kmzStatsOmitted = document.getElementById("kmzStatsOmitted");
const refCompareSection = document.getElementById("refCompareSection");
const compareOutput = document.getElementById("compareOutput");
const devToolsToggle = document.getElementById("devToolsToggle");
const startOverBtn = document.getElementById("startOverBtn");
const debugAccordions = document.querySelectorAll(".debug-accordion");

let currentParseData = null;
let lastCalcResult = null;
let lastKmzObjectUrl = null;
let lastPdfFile = null;
let devToolsVisible = false;

function selectedDwgRegionId() {
  return (dxfRegionSelect?.value ?? "").trim() || null;
}

function dwgOpts(baseOpts = {}) {
  const id = selectedDwgRegionId();
  return id ? { ...baseOpts, dwgRegionId: id } : baseOpts;
}

async function refreshDxfRegionSelect(preferId = null) {
  if (!dxfRegionSelect) return;
  const prev = preferId ?? dxfRegionSelect.value;
  const regions = await regionLibrary.listRegions();
  dxfRegionSelect.replaceChildren();
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "Automático (por GPS do poste 1)";
  dxfRegionSelect.appendChild(auto);
  for (const r of regions.sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "pt-BR"),
  )) {
    const opt = document.createElement("option");
    opt.value = r.id;
    const when = r.uploadedAt
      ? new Date(r.uploadedAt).toLocaleDateString("pt-BR")
      : "";
    opt.textContent = when ? `${r.name} (${when})` : r.name;
    dxfRegionSelect.appendChild(opt);
  }
  if (prev && [...dxfRegionSelect.options].some((o) => o.value === prev)) {
    dxfRegionSelect.value = prev;
  } else if (preferId) {
    dxfRegionSelect.value = preferId;
  }
}

async function updateDxfCloudBanner() {
  if (!dxfCloudStatus || typeof regionLibrary.refreshCloudStatus !== "function") {
    return;
  }
  const ok = await regionLibrary.refreshCloudStatus();
  if (ok) {
    dxfCloudStatus.textContent =
      "Nuvem: biblioteca DXF sincronizada (ficheiros privados no Blob).";
    dxfCloudStatus.style.color = "var(--success)";
  } else {
    dxfCloudStatus.textContent =
      "Nuvem indisponível (Blob não configurado) — só cache local neste browser.";
    dxfCloudStatus.style.color = "var(--ink-muted)";
  }
}

refreshDxfRegionSelect().catch(() => {});
updateDxfCloudBanner().catch(() => {});

// ── DWG DXF upload handler ────────────────────────────────────────────────
if (dxfUploadBtn && dxfFileInput) {
  dxfUploadBtn.addEventListener("click", () => dxfFileInput.click());
}

if (dxfFileInput) {
  dxfFileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const name =
      (dxfRegionName?.value ?? "").trim() || file.name.replace(/\.dxf$/i, "");

    if (dxfUploadStatus) {
      dxfUploadStatus.textContent = "Processando DXF...";
      dxfUploadStatus.style.color = "var(--ink-muted)";
    }

    // Pitfall #5: detect binary DWG by reading first 4 bytes.
    try {
      const headerBytes = await file.slice(0, 4).arrayBuffer();
      const header = new TextDecoder().decode(headerBytes);
      if (header.startsWith("AC1")) {
        if (dxfUploadStatus) {
          dxfUploadStatus.textContent =
            "Erro: arquivo DWG binário detectado. Re-exporte como DXF no AutoCAD (Arquivo → Salvar Como → AutoCAD DXF).";
          dxfUploadStatus.style.color = "var(--error)";
        }
        e.target.value = "";
        return;
      }
    } catch (err) {
      // Non-fatal: still try to parse via region library.
    }

    try {
      await regionLibrary.addRegion(name, file);
      await refreshDxfRegionSelect(name);
      if (dxfUploadStatus) {
        const cloud =
          regionLibrary.cloudEnabled ? " e enviada para a nuvem" : "";
        dxfUploadStatus.textContent = `Região "${name}" carregada${cloud}.`;
        dxfUploadStatus.style.color = "var(--success)";
      }
      await updateDxfCloudBanner();
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (dxfUploadStatus) {
        dxfUploadStatus.textContent = `Erro ao carregar DXF: ${msg}`;
        dxfUploadStatus.style.color = "var(--error)";
      }
    } finally {
      e.target.value = "";
    }
  });
}

function revokeKmzObjectUrl() {
  if (lastKmzObjectUrl) {
    URL.revokeObjectURL(lastKmzObjectUrl);
    lastKmzObjectUrl = null;
  }
}

function resetKmzUi() {
  revokeKmzObjectUrl();
  lastCalcResult = null;
  downloadKmzBtn.disabled = true;
  downloadKmzBtn.removeAttribute("aria-busy");
  downloadKmzBtn.textContent = "Baixar KMZ";
  downloadKmzHint.style.display = "block";
  kmzStats.style.display = "none";
  kmzStatsBody.textContent = "";
  kmzStatsOmitted.style.display = "none";
  kmzStatsOmitted.textContent = "";
}

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type; // 'error' | 'success' | 'info'
  statusEl.style.display = "block";
}

function hideStatus() {
  statusEl.style.display = "none";
  statusEl.className = "";
}

function resolveKmzFilename(userInput, pdfFileName) {
  let base = (userInput || "").trim();
  if (!base) {
    base = (pdfFileName || "rota").replace(/\.pdf$/i, "");
  }
  base =
    base.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^\.+/, "") || "rota";
  if (!/\.kmz$/i.test(base)) base += ".kmz";
  return base;
}

function getSelectedPreset(target) {
  const row = document.querySelector(`.swatch-row[data-target="${target}"]`);
  const selected = row?.querySelector('.swatch[aria-checked="true"]');
  return selected?.dataset.preset ?? DEFAULT_OPTIONS[target];
}

function readAppearanceOptions() {
  return {
    iconColor: getSelectedPreset("iconColor"),
    lineColor: getSelectedPreset("lineColor"),
    labelColor: getSelectedPreset("labelColor"),
    lineWidth: Number(lineWidthSelect.value),
    labelScale: Number(labelScaleSelect.value),
    lineDescription: lineDescriptionInput.value.trim(),
  };
}

function resetAppearanceDefaults() {
  for (const target of ["iconColor", "lineColor", "labelColor"]) {
    const row = document.querySelector(`.swatch-row[data-target="${target}"]`);
    if (!row) continue;
    for (const btn of row.querySelectorAll(".swatch")) {
      const isDefault = btn.dataset.preset === DEFAULT_OPTIONS[target];
      btn.setAttribute("aria-checked", isDefault ? "true" : "false");
    }
  }
  lineWidthSelect.value = String(DEFAULT_OPTIONS.lineWidth);
  labelScaleSelect.value = String(DEFAULT_OPTIONS.labelScale);
  lineDescriptionInput.value = DEFAULT_OPTIONS.lineDescription;
}

function initAppearanceControls() {
  for (let w = 1; w <= 8; w++) {
    const opt = document.createElement("option");
    opt.value = String(w);
    opt.textContent = String(w);
    if (w === DEFAULT_OPTIONS.lineWidth) opt.selected = true;
    lineWidthSelect.appendChild(opt);
  }

  function refreshSwatchTabStops(row) {
    const radios = Array.from(row.querySelectorAll(".swatch"));
    const activeIndex = Math.max(
      0,
      radios.findIndex((b) => b.getAttribute("aria-checked") === "true"),
    );
    radios.forEach((b, idx) => {
      b.tabIndex = idx === activeIndex ? 0 : -1;
    });
  }

  function selectSwatch(row, btn) {
    for (const s of row.querySelectorAll(".swatch")) {
      s.setAttribute("aria-checked", "false");
    }
    btn.setAttribute("aria-checked", "true");
    refreshSwatchTabStops(row);
    btn.focus();
  }

  for (const row of document.querySelectorAll(".swatch-row")) {
    const target = row.dataset.target;
    for (const [key, hex] of Object.entries(PRESET_COLORS)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "swatch";
      btn.dataset.preset = key;
      btn.dataset.target = target;
      btn.style.backgroundColor = hex;
      btn.title = key;
      btn.setAttribute("role", "radio");
      btn.setAttribute(
        "aria-checked",
        key === DEFAULT_OPTIONS[target] ? "true" : "false",
      );
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        selectSwatch(row, btn);
      });
      btn.addEventListener("keydown", (e) => {
        const key = e.key;
        if (
          key !== "ArrowLeft" &&
          key !== "ArrowRight" &&
          key !== "ArrowUp" &&
          key !== "ArrowDown"
        ) {
          return;
        }
        e.preventDefault();
        const radios = Array.from(row.querySelectorAll(".swatch"));
        const currentIndex = Math.max(0, radios.indexOf(btn));
        const dir = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
        const nextIndex = (currentIndex + dir + radios.length) % radios.length;
        const next = radios[nextIndex];
        if (next) selectSwatch(row, next);
      });
      row.appendChild(btn);
    }
    refreshSwatchTabStops(row);
  }
}

function setUploadIdle() {
  uploadZone.hidden = false;
  uploadSelected.hidden = true;
  uploadFileName.textContent = "";
  pdfInput.value = "";
}

function setUploadSelected(file) {
  uploadZone.hidden = true;
  uploadSelected.hidden = false;
  uploadFileName.textContent = file.name;
}

function resetSession() {
  hideStatus();
  summaryEl.style.display = "none";
  summaryList.innerHTML = "";
  warningsEl.style.display = "none";
  warningsList.innerHTML = "";
  coordForm.style.display = "none";
  resultSection.style.display = "none";
  coordWarning.style.display = "none";
  gpsInput.value = "";
  gpsInputLast.value = "";
  kmzFilenameInput.value = "";
  secondAnchorPanel.hidden = true;
  secondAnchorToggle.setAttribute("aria-expanded", "false");
  currentParseData = null;
  lastPdfFile = null;
  resetKmzUi();
  resetAppearanceDefaults();
  setUploadIdle();
  debugSection.style.display = "none";
  refCompareSection.style.display = "none";
  for (const accordion of debugAccordions) accordion.open = false;
  devToolsVisible = false;
  devToolsToggle.textContent = "Show developer tools";
  compareOutput.style.display = "none";
}

function setParsingUi(blocked) {
  const toggle = (el, on) => {
    if (!el) return;
    el.disabled = !on;
  };
  toggle(browsePdfBtn, !blocked);
  toggle(changeFileBtn, !blocked);
  toggle(gpsInput, !blocked);
  toggle(gpsInputLast, !blocked);
  toggle(calcBtn, !blocked);
  toggle(downloadKmzBtn, !blocked);
  toggle(lineWidthSelect, !blocked);
  toggle(labelScaleSelect, !blocked);
  toggle(lineDescriptionInput, !blocked);
  toggle(kmzFilenameInput, !blocked);
  toggle(secondAnchorToggle, !blocked);
  toggle(dxfUploadBtn, !blocked);
  toggle(dxfRegionName, !blocked);
  toggle(dxfRegionSelect, !blocked);
  for (const sw of document.querySelectorAll(".swatch")) {
    toggle(sw, !blocked);
  }
  uploadSection.setAttribute("aria-busy", blocked ? "true" : "false");
}

function isPdfFile(file) {
  if (!file) return false;
  if (file.type === "application/pdf") return true;
  return /\.pdf$/i.test(file.name || "");
}

async function handlePdfFile(file) {
  if (!file) return;
  if (!isPdfFile(file)) {
    showStatus("Escolha um arquivo PDF com extensão .pdf.", "error");
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showStatus("O arquivo passa de 50 MB. Selecione um PDF menor.", "error");
    return;
  }

  resetSession();
  lastPdfFile = file;
  setUploadSelected(file);
  setParsingUi(true);

  let buf;
  try {
    buf = await file.arrayBuffer();
  } catch (err) {
    showStatus("Não foi possível ler o arquivo: " + err.message, "error");
    setParsingUi(false);
    return;
  }

  let result;
  try {
    result = await parsePdf(buf, {
      onProgress: ({ message }) => showStatus(message, "info"),
    });
  } catch (err) {
    showStatus("Erro inesperado: " + err.message, "error");
    return;
  } finally {
    setParsingUi(false);
  }

  if (result.error === "missing_layers") {
    const missingStr = result.missing.join(", ");
    const availableStr = result.allNames.join(", ");
    showStatus(
      "Camadas obrigatórias não encontradas no PDF: " +
        missingStr +
        ". Camadas disponíveis: " +
        availableStr,
      "error",
    );
    return;
  }

  if (result.error === "parse_failed") {
    showStatus("Não foi possível ler o PDF: " + result.message, "error");
    showWarnings(result.warnings);
    return;
  }

  showStatus("PDF lido com sucesso.", "success");

  summaryList.innerHTML = "";
  const summaryData = [
    "Postes encontrados: " + result.posts.length,
    "Distâncias encontradas: " + result.distances.length,
    "Trechos de cabo encontrados: " + result.cableSegments.length,
  ];
  for (const text of summaryData) {
    const li = document.createElement("li");
    li.textContent = text;
    summaryList.appendChild(li);
  }
  summaryEl.style.display = "block";

  currentParseData = {
    posts: result.posts,
    distances: result.distances,
    cableSegments: result.cableSegments,
    utmGridPathsPerPage: result.utmGridPathsPerPage,
    viewportBoxes: result.viewportBoxes,
    pageDimensions: result.pageDimensions,
  };

  coordForm.style.display = "block";
  showWarnings(result.warnings);
  showDebug(dumpCalibrationData(result));
}

initAppearanceControls();

function showWarnings(warnings) {
  if (!warnings || warnings.length === 0) return;
  warningsList.innerHTML = "";
  for (const w of warnings) {
    const li = document.createElement("li");
    li.textContent = w;
    warningsList.appendChild(li);
  }
  warningsEl.style.display = "block";
}

browsePdfBtn.addEventListener("click", () => pdfInput.click());
changeFileBtn.addEventListener("click", () => resetSession());
pdfInput.addEventListener("change", () => {
  const file = pdfInput.files?.[0];
  if (file) handlePdfFile(file);
});
startOverBtn.addEventListener("click", () => location.reload());
secondAnchorToggle.addEventListener("click", () => {
  const open = secondAnchorPanel.hidden;
  secondAnchorPanel.hidden = !open;
  secondAnchorToggle.setAttribute("aria-expanded", open ? "true" : "false");
});
devToolsToggle.addEventListener("click", () => {
  devToolsVisible = !devToolsVisible;
  const display = devToolsVisible ? "block" : "none";
  debugSection.style.display = display;
  refCompareSection.style.display = display;
  devToolsToggle.textContent = devToolsVisible
    ? "Hide developer tools"
    : "Show developer tools";
});

uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});
uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("drag-over");
});
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer?.files?.[0];
  if (file) handlePdfFile(file);
});

calcBtn.addEventListener("click", async () => {
  coordWarning.style.display = "none";
  resultSection.style.display = "none";
  revokeKmzObjectUrl();
  kmzStats.style.display = "none";

  const inputVal = gpsInput.value;
  const parsed = parseCoordinateInput(inputVal);

  if (!parsed) {
    coordWarning.textContent =
      "Formato inválido. Use latitude e longitude, por exemplo: -27.645312, -48.671234";
    coordWarning.style.display = "block";
    return;
  }

  const { lat, lon } = parsed;
  const boundsCheck = validateBrazilBounds(lat, lon);

  if (!boundsCheck.valid) {
    // D-15: Show warning but do not reject
    coordWarning.textContent = "Aviso: " + boundsCheck.message;
    coordWarning.style.display = "block";
  }

  if (!currentParseData || !currentParseData.posts.length) {
    coordWarning.textContent =
      "Nenhum poste foi lido ainda. Envie um PDF antes de calcular.";
    coordWarning.style.display = "block";
    return;
  }

  // Read optional 2nd-anchor input (D-ACC-07)
  const lastInputVal = document.getElementById("gpsInputLast").value;
  const lastParsed =
    lastInputVal && lastInputVal.trim()
      ? parseCoordinateInput(lastInputVal)
      : null;
  if (lastInputVal && lastInputVal.trim() && !lastParsed) {
    coordWarning.textContent =
      "As coordenadas do último poste estão em formato inválido. O cálculo seguirá apenas com o poste 1.";
    coordWarning.style.display = "block";
  }

  // Deep clone to avoid mutating the original parse result on multiple runs
  const postsCopy = JSON.parse(JSON.stringify(currentParseData.posts));

  const opts = dwgOpts({
    utmGridPathsPerPage: currentParseData.utmGridPathsPerPage,
    viewportBoxes: currentParseData.viewportBoxes,
    pageDimensions: currentParseData.pageDimensions,
    distanceLabelItems: currentParseData.distanceLabelItems,
    ...(lastParsed ? { lastPostGps: lastParsed } : {}),
  });
  let result;
  try {
    result = await calculateCoordinatesWithDwg(
      postsCopy,
      currentParseData.distances,
      lat,
      lon,
      currentParseData.cableSegments,
      opts,
      regionLibrary,
    );
  } catch (err) {
    coordWarning.textContent =
      "Erro ao calcular a rota: " + (err?.message ?? String(err));
    coordWarning.style.display = "block";
    console.error("[pdf-to-kmz] calculateCoordinatesWithDwg failed:", err);
    return;
  }
  const { posts: calculatedPosts, connections } = result;

  console.log("[pdf-to-kmz] Generated connections:", connections);

  // Surface calculation warnings into #warningsList (D-ACC-08 label sanity, snap fallbacks, 2nd-anchor)
  const calcWarnings =
    result && Array.isArray(result.warnings) ? result.warnings : [];
  for (const w of calcWarnings) {
    const li = document.createElement("li");
    li.textContent =
      "[calc] " + (typeof w === "string" ? w : formatDwgWarning(w));
    document.getElementById("warningsList").appendChild(li);
  }
  if (calcWarnings.length) {
    warningsEl.style.display = "block";
  }

  // Debug: dump post transforms and projected coords
  {
    const dbLines = debugOutput.textContent.split("\n");
    const calcLines = [];
    calcLines.push(
      "\n══ CALCULATION DEBUG ═══════════════════════════════════════════════════",
    );
    calcLines.push(`\nProjected coordinates:`);
    for (const p of calculatedPosts) {
      const latStr = p.lat != null ? p.lat.toFixed(8) : "null";
      const lonStr = p.lon != null ? p.lon.toFixed(8) : "null";
      calcLines.push(
        `  Post ${String(p.number).padStart(2, "0")}: lat=${latStr}  lon=${lonStr}  page=${p.pageNum ?? "?"}  x=${p.x != null ? p.x.toFixed(2) : "?"}  y=${p.y != null ? p.y.toFixed(2) : "?"}`,
      );
    }
    calcLines.push(
      "\n══ END CALCULATION DEBUG ═══════════════════════════════════════════════",
    );
    showDebug(dbLines.join("\n") + "\n" + calcLines.join("\n"));
  }

  const branchStarts = connections.filter((c) => c.from !== c.to - 1).length;
  const gaps = connections.filter((c) => c.gap).length;

  // Display preview
  resultSection.style.display = "block";

  const summaryText = `\nConexões: ${connections.length} (${gaps} lacunas, ${branchStarts} ramificações)\n`;

  const preview = calculatedPosts
    .slice(0, 10)
    .map((p) => {
      const latStr = p.lat != null ? p.lat.toFixed(6) : "sem GPS";
      const lonStr = p.lon != null ? p.lon.toFixed(6) : "sem GPS";
      return `Poste ${String(p.number).padStart(2, "0")}: ${latStr}, ${lonStr} ${p.postType ? "(" + p.postType + ")" : ""}`;
    })
    .join("\n");

  outputPreview.textContent =
    summaryText +
    preview +
    (calculatedPosts.length > 10
      ? "\n... e mais " + (calculatedPosts.length - 10)
      : "");

  lastCalcResult = {
    posts: calculatedPosts,
    connections,
    warnings: calcWarnings,
  };
  const placemarkEligible = calculatedPosts.filter(
    (p) => p.lat != null && p.lon != null,
  ).length;
  downloadKmzBtn.disabled = placemarkEligible === 0;
  downloadKmzHint.style.display = placemarkEligible === 0 ? "block" : "none";
  downloadKmzBtn.textContent = "Baixar KMZ";
  downloadKmzBtn.removeAttribute("aria-busy");
});

downloadKmzBtn.addEventListener("click", async () => {
  if (!lastCalcResult) return;

  const placemarkEligible = lastCalcResult.posts.filter(
    (p) => p.lat != null && p.lon != null,
  ).length;
  downloadKmzBtn.disabled = true;
  downloadKmzBtn.setAttribute("aria-busy", "true");
  downloadKmzBtn.textContent = "Gerando KMZ...";

  try {
    const opts = mergeOptions(readAppearanceOptions());
    const { kml, stats } = buildKml(
      lastCalcResult.posts,
      lastCalcResult.connections,
      opts,
    );

    if (stats.placemarkCount === 0) {
      showStatus(
        "Nenhum poste tem GPS. Corrija as coordenadas e calcule novamente.",
        "error",
      );
      return;
    }

    const blob = await packageKmz(kml);
    revokeKmzObjectUrl();
    const url = URL.createObjectURL(blob);
    lastKmzObjectUrl = url;
    const a = document.createElement("a");
    a.href = url;
    a.download = resolveKmzFilename(kmzFilenameInput.value, lastPdfFile?.name);
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();

    kmzStatsBody.textContent = `${stats.placemarkCount} postes no mapa. ${stats.lineCount} linhas de rota.`;
    if (stats.omittedNoGps > 0) {
      kmzStatsOmitted.textContent = `${stats.omittedNoGps} postes ficaram fora do KMZ porque não têm coordenadas GPS.`;
      kmzStatsOmitted.style.display = "block";
      const li = document.createElement("li");
      li.textContent = `[kmz] ${stats.omittedNoGps} postes sem coordenadas GPS ficaram fora do KMZ.`;
      warningsList.appendChild(li);
      warningsEl.style.display = "block";
    } else {
      kmzStatsOmitted.style.display = "none";
      kmzStatsOmitted.textContent = "";
    }
    for (const w of stats.warnings || []) {
      const li = document.createElement("li");
      li.textContent = "[kmz] " + w;
      warningsList.appendChild(li);
      warningsEl.style.display = "block";
    }
    kmzStats.style.display = "block";
    showStatus("KMZ pronto. Abra o arquivo no Google Earth.", "success");
  } catch (err) {
    const msg = String(err?.message || err);
    const statusMsg = /package|zip/i.test(msg)
      ? `Não foi possível empacotar o KMZ: ${msg}`
      : `Não foi possível gerar o KMZ: ${msg}`;
    showStatus(statusMsg, "error");
  } finally {
    downloadKmzBtn.textContent = "Baixar KMZ";
    downloadKmzBtn.removeAttribute("aria-busy");
    downloadKmzBtn.disabled = placemarkEligible === 0;
  }
});
// ── Reference comparison ───────────────────────────────────────────────────
const compareBtn1 = document.getElementById("compareBtn1");
const compareBtn2 = document.getElementById("compareBtn2");
const fillRef34Btn = document.getElementById("fillRef34Btn");
const refInput = document.getElementById("refInput");

// Haversine in-browser (no import needed)
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180,
    phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180,
    dLam = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseReferenceLines() {
  const refs = [];
  for (const line of refInput.value.trim().split("\n")) {
    const m = line.match(/poste\s+(\d+).*?([-\d.]+)\s*,\s*([-\d.]+)/i);
    if (m)
      refs.push({
        num: parseInt(m[1], 10),
        lat: parseFloat(m[2]),
        lon: parseFloat(m[3]),
      });
  }
  return refs;
}

fillRef34Btn.addEventListener("click", () => {
  const ref34 = parseReferenceLines().find((r) => r.num === 34);
  if (!ref34) {
    compareOutput.textContent =
      "Reference has no post 34 — paste full João Born list first.";
    compareOutput.style.display = "block";
    return;
  }
  document.getElementById("gpsInputLast").value = `${ref34.lat}, ${ref34.lon}`;
  compareOutput.style.display = "none";
});

async function runReferenceCompare(twoAnchors) {
  if (!currentParseData) {
    compareOutput.textContent = "No parse data yet — upload a PDF first.";
    compareOutput.style.display = "block";
    return;
  }

  const refs = parseReferenceLines();
  if (refs.length === 0) {
    compareOutput.textContent =
      'Could not parse reference lines. Expected format: "poste 01; -27.xxx, -48.xxx"';
    compareOutput.style.display = "block";
    return;
  }

  const ref1 = refs.find((r) => r.num === 1);
  if (!ref1) {
    compareOutput.textContent = "Reference must include post #1.";
    compareOutput.style.display = "block";
    return;
  }

  let lastPostGps = null;
  let anchorNote = "Anchors: post 1 from reference (single-anchor UTM)";
  if (twoAnchors) {
    const ref34 = refs.find((r) => r.num === 34);
    if (!ref34 || ref34.num !== 34) {
      compareOutput.textContent =
        "Two-anchor compare needs post 34 in the reference list.";
      compareOutput.style.display = "block";
      return;
    }
    lastPostGps = { lat: ref34.lat, lon: ref34.lon };
    anchorNote =
      "Anchors: post 1 + post 34 from reference (similarity refinement)";
  }

  const postsCopy = JSON.parse(JSON.stringify(currentParseData.posts));
  const calcOpts = dwgOpts({
    utmGridPathsPerPage: currentParseData.utmGridPathsPerPage,
    viewportBoxes: currentParseData.viewportBoxes,
    pageDimensions: currentParseData.pageDimensions,
    distanceLabelItems: currentParseData.distanceLabelItems,
    posteRawCentroids: currentParseData.posteRawCentroids,
    ...(lastPostGps ? { lastPostGps } : {}),
  });
  let calcResult;
  try {
    calcResult = await calculateCoordinatesWithDwg(
      postsCopy,
      currentParseData.distances,
      ref1.lat,
      ref1.lon,
      currentParseData.cableSegments,
      calcOpts,
      regionLibrary,
    );
  } catch (err) {
    compareOutput.textContent =
      "Erro ao comparar: " + (err?.message ?? String(err));
    compareOutput.style.display = "block";
    console.error("[pdf-to-kmz] reference compare failed:", err);
    return;
  }
  const calcPosts = calcResult.posts;
  const calcWarnings = calcResult.warnings ?? [];

  const postMap = new Map(calcPosts.map((p) => [p.number, p]));

  const lines = [];
  const pad = (s, n) => String(s).padEnd(n);
  lines.push(anchorNote);
  lines.push(`Pipeline: ${CALC_PIPELINE_ID}`);
  const dwgCount = calcPosts.filter((p) => p.source === "dwg").length;
  const dwgStatus = calcResult.dwgStatus ?? "unknown";
  lines.push(
    `DWG: ${dwgStatus} | ${dwgCount}/${calcPosts.length} postes com coord. DXF` +
      (calcResult.dwgRegionId ? ` (região: ${calcResult.dwgRegionId})` : ""),
  );
  const dwgWarns = calcWarnings.filter(
    (w) => w && typeof w === "object" && String(w.kind ?? "").startsWith("dwg"),
  );
  if (dwgWarns.length) {
    lines.push("Avisos DWG:");
    for (const w of dwgWarns) lines.push("  " + formatDwgWarning(w));
  }
  lines.push("");
  lines.push(
    pad("Post", 6) +
      pad("Ref lat", 20) +
      pad("Calc lat", 20) +
      pad("Ref lon", 20) +
      pad("Calc lon", 20) +
      pad("Error (m)", 12) +
      "Status",
  );
  lines.push("─".repeat(102));

  let maxErr = 0,
    nullCount = 0;
  for (const ref of refs) {
    const calc = postMap.get(ref.num);
    if (!calc || calc.lat == null) {
      lines.push(
        pad(ref.num, 6) +
          pad(ref.lat.toFixed(8), 20) +
          pad("null", 20) +
          pad(ref.lon.toFixed(8), 20) +
          pad("null", 20) +
          pad("—", 12) +
          "✗ NO GPS",
      );
      nullCount++;
      continue;
    }
    const errM = haversineM(ref.lat, ref.lon, calc.lat, calc.lon);
    if (errM > maxErr) maxErr = errM;
    const ok = errM < 5 ? "✓" : errM < 50 ? "~" : "✗";
    lines.push(
      pad(ref.num, 6) +
        pad(ref.lat.toFixed(8), 20) +
        pad(calc.lat.toFixed(8), 20) +
        pad(ref.lon.toFixed(8), 20) +
        pad(calc.lon.toFixed(8), 20) +
        pad(errM.toFixed(2) + "m", 12) +
        ok,
    );
  }
  lines.push("─".repeat(102));
  lines.push(
    `Max error: ${maxErr.toFixed(2)} m  |  Posts with null GPS: ${nullCount}/${refs.length}`,
  );
  lines.push("");
  lines.push("Legend: ✓ < 5m  ~ 5–50m  ✗ > 50m or null");
  const calKeys = calcWarnings.filter((w) =>
    /seam-lock|seam-locked|boundary-locked|Global label fit|label-lsq|Repositioned/i.test(
      w,
    ),
  );
  if (calKeys.length) {
    lines.push("");
    lines.push("Calibration (compare run):");
    for (const w of calKeys) lines.push("  " + w);
  }

  compareOutput.textContent = lines.join("\n");
  compareOutput.style.display = "block";
}

compareBtn1.addEventListener("click", () => runReferenceCompare(false));
compareBtn2.addEventListener("click", () => runReferenceCompare(true));

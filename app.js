/* ================================================================
   FOLIOMARK — app.js
   Lógica principal: carga PDF, vista previa, numeración, descarga
================================================================ */

// ---- STATE ----
const state = {
  // Multi-file list: [{ file, bytes, pageCount }]
  fileList: [],
  pdfBytes: null,    // merged pdf bytes
  pdfJsDoc: null,    // pdf.js document (for preview)
  totalPages: 0,
  currentPage: 1,
  mode: 'normal',
  startNum: 1,
  numStyle: 'arabic',
  position: 'top-center',
  color: '#1a1a1a',
  resultBytes: null,
  rangeFrom: 1,
  rangeTo: '',
  pageFilter: 'all',
  skipPages: '',
  template: '{n}',
  fontFamily: 'helvetica',
  fontSize: 12,
};

// ---- DOM REFS ----
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const configPanel = document.getElementById('config-panel');
const downloadPanel = document.getElementById('download-panel');
const previewCanvas = document.getElementById('preview-canvas');
const previewOverlay = document.getElementById('preview-num-overlay');
const pageIndicator = document.getElementById('page-indicator');
const startNumInput = document.getElementById('start-num');
const fileListEl = document.getElementById('file-list');
const fileListTotal = document.getElementById('file-list-total');

// ---- NAVBAR SCROLL ----
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  nav.classList.toggle('scrolled', window.scrollY > 10);
});

// ---- UPLOAD DRAG & DROP ----
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragging');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragging'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragging');
  const files = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf');
  if (files.length) loadFiles(files);
  else alert('Por favor, sube archivos PDF válidos.');
});
uploadZone.addEventListener('click', (e) => {
  if (e.target !== fileInput && !e.target.closest('label')) fileInput.click();
});
fileInput.addEventListener('change', (e) => {
  const files = [...e.target.files];
  if (files.length) loadFiles(files);
  fileInput.value = ''; // reset so same file can be re-added
});

// ---- LOAD FILES (multi) ----
const MAX_SIZE = 100 * 1024 * 1024; // 100MB

function isValidPDF(file) {
  return file.type === 'application/pdf' && file.name.toLowerCase().endsWith('.pdf');
}

async function loadFiles(newFiles) {
  // Append new files to the list (avoid true duplicates by name+size)
  for (const file of newFiles) {
    if (!isValidPDF(file)) {
      alert(`El archivo "${file.name}" no es un PDF válido.`);
      continue;
    }
    if (file.size > MAX_SIZE) {
      alert(`El archivo "${file.name}" supera el límite de 100MB.`);
      continue;
    }
    const isDup = state.fileList.some(f => f.file.name === file.name && f.file.size === file.size);
    if (isDup) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const tmpDoc = await PDFLib.PDFDocument.load(bytes);
    state.fileList.push({ file, bytes, pageCount: tmpDoc.getPageCount() });
  }

  if (state.fileList.length === 0) return;

  // Merge all into one PDF
  const mergedDoc = await PDFLib.PDFDocument.create();
  for (const entry of state.fileList) {
    const srcDoc = await PDFLib.PDFDocument.load(entry.bytes);
    const copied = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    copied.forEach(p => mergedDoc.addPage(p));
  }

  state.pdfBytes = await mergedDoc.save();
  state.totalPages = mergedDoc.getPageCount();
  state.currentPage = 1;

  // pdf.js for preview
  const loadingTask = pdfjsLib.getDocument({ data: state.pdfBytes.slice() });
  state.pdfJsDoc = await loadingTask.promise;

  renderFileList();

  // Show config panel
  uploadZone.classList.add('hidden');
  configPanel.classList.remove('hidden');
  downloadPanel.classList.add('hidden');

  await renderPreview();
}

// ---- RENDER FILE LIST UI ----
function renderFileList() {
  fileListEl.innerHTML = '';
  let totalPages = 0;
  state.fileList.forEach((entry, idx) => {
    totalPages += entry.pageCount;
    const item = document.createElement('div');
    item.className = 'file-list-item';
    const safeName = entry.file.name.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    item.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--primary)">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="file-list-item-name" title="${safeName}">${safeName}</span>
      <span class="file-list-item-pages">${entry.pageCount} pág.</span>
      <button class="file-list-item-remove" title="Quitar" onclick="removeFile(${idx})">&#x2715;</button>
    `;
    fileListEl.appendChild(item);
  });
  const count = state.fileList.length;
  fileListTotal.textContent = count === 1
    ? `1 archivo — ${totalPages} páginas`
    : `${count} archivos fusionados — ${totalPages} páginas totales`;
}

// ---- REMOVE FILE ----
async function removeFile(idx) {
  state.fileList.splice(idx, 1);
  if (state.fileList.length === 0) {
    resetToUpload();
    return;
  }
  await loadFiles([]); // re-merge remaining
}

// ---- RENDER PREVIEW ----
async function renderPreview() {
  if (!state.pdfJsDoc) return;

  const page = await state.pdfJsDoc.getPage(state.currentPage);
  const viewport = page.getViewport({ scale: 1.2 });

  const ctx = previewCanvas.getContext('2d');
  previewCanvas.width = viewport.width;
  previewCanvas.height = viewport.height;

  await page.render({ canvasContext: ctx, viewport }).promise;

  pageIndicator.textContent = `Página ${state.currentPage} de ${state.totalPages}`;

  // Overlay number
  updateOverlay();
}

// ---- OVERLAY NUMBER ----
function updateOverlay() {
  if (!shouldNumberPage(state.currentPage)) {
    previewOverlay.style.display = 'none';
    return;
  }

  const pageNum = computePageNumber(state.currentPage);
  const totalLogical = computeTotalLogical();
  const label = formatTemplate(pageNum, totalLogical);

  previewOverlay.style.display = state.numStyle === 'circle' ? 'flex' : 'block';
  previewOverlay.textContent = label;
  previewOverlay.style.color = state.color;

  // Apply font
  if (state.fontFamily === 'times') {
    previewOverlay.style.fontFamily = "'DM Serif Display', serif";
  } else if (state.fontFamily === 'courier') {
    previewOverlay.style.fontFamily = "'Courier New', monospace";
  } else {
    previewOverlay.style.fontFamily = "'Inter', sans-serif";
  }
  previewOverlay.style.fontSize = state.fontSize + 'px';



  if (state.numStyle === 'circle') {
    previewOverlay.style.background = state.color;
    previewOverlay.style.color = '#fff';
    previewOverlay.style.borderRadius = '50%';
    previewOverlay.style.width = '32px';
    previewOverlay.style.height = '32px';
    previewOverlay.style.display = 'flex';
    previewOverlay.style.alignItems = 'center';
    previewOverlay.style.justifyContent = 'center';
    previewOverlay.style.padding = '0';
    previewOverlay.style.border = 'none';
  } else {
    previewOverlay.style.background = 'rgba(255,255,255,.85)';
    previewOverlay.style.borderRadius = '4px';
    previewOverlay.style.width = 'auto';
    previewOverlay.style.height = 'auto';
    previewOverlay.style.padding = '2px 8px';
    previewOverlay.style.border = '1px solid #E2E8F0';
  }

  // Position
  const positions = {
    'top-left': { top: '12px', left: '12px', bottom: 'auto', right: 'auto' },
    'top-center': { top: '12px', left: '50%', transform: 'translateX(-50%)', bottom: 'auto', right: 'auto' },
    'top-right': { top: '12px', right: '12px', bottom: 'auto', left: 'auto' },
    'bottom-left': { bottom: '12px', left: '12px', top: 'auto', right: 'auto' },
    'bottom-center': { bottom: '12px', left: '50%', transform: 'translateX(-50%)', top: 'auto', right: 'auto' },
    'bottom-right': { bottom: '12px', right: '12px', top: 'auto', left: 'auto' },
  };

  const pos = positions[state.position] || positions['top-center'];
  Object.assign(previewOverlay.style, {
    top: pos.top || 'auto', bottom: pos.bottom || 'auto',
    left: pos.left || 'auto', right: pos.right || 'auto',
    transform: pos.transform || 'none',
  });
}

// ---- SHOULD NUMBER PAGE (includes skipPages) ----
function parseSkipSet(str) {
  const set = new Set();
  if (!str.trim()) return set;
  str.split(',').forEach(part => {
    part = part.trim();
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a; i <= b; i++) set.add(i);
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) set.add(n);
    }
  });
  return set;
}

function shouldNumberPage(pageIndex) {
  if (pageIndex < state.rangeFrom) return false;

  const to = parseInt(state.rangeTo, 10);
  if (!isNaN(to) && pageIndex > to) return false;

  if (state.pageFilter === 'even' && pageIndex % 2 !== 0) return false;
  if (state.pageFilter === 'odd' && pageIndex % 2 === 0) return false;

  const skipSet = parseSkipSet(state.skipPages);
  if (skipSet.has(pageIndex)) return false;

  return true;
}

function computeTotalLogical() {
  let count = 0;
  for (let i = 1; i <= state.totalPages; i++) {
    if (shouldNumberPage(i)) count++;
  }
  return count;
}

function computeLogicalIndex(pageIndex) {
  let count = 0;
  for (let i = 1; i <= state.totalPages; i++) {
    if (shouldNumberPage(i)) {
      count++;
      if (i === pageIndex) return count;
    }
  }
  return -1;
}

function computePageNumber(pageIndex) {
  const logicalIndex = computeLogicalIndex(pageIndex);
  if (logicalIndex === -1) return -1;
  const totalLogical = computeTotalLogical();

  if (state.mode === 'normal') {
    return state.startNum + (logicalIndex - 1);
  } else {
    return state.startNum + (totalLogical - logicalIndex);
  }
}

// ---- FORMAT NUMBER ----
function formatTemplate(n, total) {
  let formattedN = formatNumber(n, state.numStyle);
  let result = state.template.replace(/{n}/g, formattedN);
  result = result.replace(/{total}/g, total);
  return result;
}

function formatNumber(n, style) {
  switch (style) {
    case 'arabic': return String(n);
    case 'roman': return toRoman(n);
    case 'letter': return numToLetter(n);
    case 'circle': return circledNum(n);
    case 'formal': return String(n);
    case 'dash': return `– ${n} –`;
    default: return String(n);
  }
}

function toRoman(num) {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (num >= vals[i]) { result += syms[i]; num -= vals[i]; }
  }
  return result;
}

function numToLetter(n) {
  let result = '';
  n = n - 1;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

function circledNum(n) {
  if (n >= 1 && n <= 20) {
    const circles = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
      '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
    return circles[n - 1];
  }
  return `(${n})`;
}

// ---- NAVIGATE PAGES ----
function changePage(delta) {
  const next = state.currentPage + delta;
  if (next < 1 || next > state.totalPages) return;
  state.currentPage = next;
  renderPreview();
}

// ---- MODE SELECTION ----
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    state.mode = radio.value;
    document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('selected'));
    radio.closest('.radio-card').classList.add('selected');
    updateOverlay();
  });
});

// ---- START NUMBER ----
startNumInput.addEventListener('input', () => {
  const v = parseInt(startNumInput.value, 10);
  if (!isNaN(v) && v >= 0) {
    state.startNum = v;
    updateOverlay();
  }
});

function adjustNum(delta) {
  const v = parseInt(startNumInput.value, 10) || 1;
  const next = Math.max(0, v + delta);
  startNumInput.value = next;
  state.startNum = next;
  updateOverlay();
}

// ---- NEW INPUTS EVENT LISTENERS ----
document.getElementById('range-from').addEventListener('input', (e) => {
  state.rangeFrom = parseInt(e.target.value, 10) || 1;
  updateOverlay();
});
document.getElementById('range-to').addEventListener('input', (e) => {
  state.rangeTo = e.target.value;
  updateOverlay();
});
document.getElementById('skip-pages').addEventListener('input', (e) => {
  state.skipPages = e.target.value;
  updateOverlay();
});
document.getElementById('page-filter').addEventListener('change', (e) => {
  state.pageFilter = e.target.value;
  updateOverlay();
});
document.getElementById('text-template').addEventListener('input', (e) => {
  state.template = e.target.value || '{n}';
  updateOverlay();
});
document.getElementById('font-family').addEventListener('change', (e) => {
  state.fontFamily = e.target.value;
  updateOverlay();
});
document.getElementById('font-size').addEventListener('input', (e) => {
  state.fontSize = parseInt(e.target.value, 10) || 12;
  updateOverlay();
});

// ---- STYLE SELECTION ----
function selectStyle(btn) {
  document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  state.numStyle = btn.dataset.style;
  updateOverlay();
}

// ---- POSITION SELECTION ----
function selectPos(btn) {
  document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  state.position = btn.dataset.pos;
  updateOverlay();
}

// ---- COLOR SELECTION ----
function selectColor(btn) {
  document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  state.color = btn.dataset.color;
  updateOverlay();
}

function customColor(input) {
  document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('selected'));
  state.color = input.value;
  updateOverlay();
}

// ---- APPLY NUMBERS (pdf-lib) ----
async function applyNumbers() {
  const btn = document.getElementById('btn-apply');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = 'Procesando…';

  try {
    // Load fresh copy
    const pdfDoc = await PDFLib.PDFDocument.load(state.pdfBytes);
    const pages = pdfDoc.getPages();
    const total = pages.length;

    // Embed font
    let font;
    if (state.fontFamily === 'times') {
      font = await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRoman);
    } else if (state.fontFamily === 'courier') {
      font = await pdfDoc.embedFont(PDFLib.StandardFonts.Courier);
    } else {
      font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
    }

    const fontSize = state.fontSize;

    // Parse color
    const rgb = hexToRgb(state.color);
    const totalLogical = computeTotalLogical();

    for (let i = 0; i < total; i++) {
      const pageIndex = i + 1; // 1-based

      if (!shouldNumberPage(pageIndex)) continue;

      const page = pages[i];
      const { width, height } = page.getSize();

      const pageNum = computePageNumber(pageIndex);
      const label = formatTemplate(pageNum, totalLogical);

      const textWidth = font.widthOfTextAtSize(label, fontSize);
      const margin = 36; // ~1.27cm

      // Compute X, Y based on position
      let x, y;
      const [vPos, hPos] = state.position.split('-');

      // Horizontal
      if (hPos === 'left') x = margin;
      else if (hPos === 'right') x = width - margin - textWidth;
      else x = (width - textWidth) / 2; // center

      // Vertical
      if (vPos === 'top') y = height - margin;
      else y = margin; // bottom

      // Draw
      if (state.numStyle === 'circle') {
        const circleR = fontSize * 0.8;
        page.drawCircle({
          x: x + textWidth / 2,
          y: y - fontSize * 0.2,
          size: circleR,
          color: PDFLib.rgb(rgb.r / 255, rgb.g / 255, rgb.b / 255),
        });
        page.drawText(label, {
          x: x + 1,
          y: y - fontSize * 0.35,
          size: fontSize - 2,
          font,
          color: PDFLib.rgb(1, 1, 1),
        });
      } else {
        page.drawText(label, {
          x,
          y,
          size: fontSize,
          font,
          color: PDFLib.rgb(rgb.r / 255, rgb.g / 255, rgb.b / 255),
        });

        // Dash style: draw lines
        if (state.numStyle === 'dash') {
          // already included in label "– N –"
        }
      }
    }

    state.resultBytes = await pdfDoc.save();
    const blob = new Blob([state.resultBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    // Build output filename
    const baseName = state.fileList.length === 1
      ? state.fileList[0].file.name.replace('.pdf', '')
      : 'documentos_fusionados';
    const dlBtn = document.getElementById('btn-download');
    dlBtn.href = url;
    dlBtn.download = baseName + '_numerado.pdf';

    document.getElementById('dl-sub-text').textContent =
      `${total} página${total !== 1 ? 's' : ''} numeradas con éxito. Descarga el archivo listo.`;

    configPanel.classList.add('hidden');
    downloadPanel.classList.remove('hidden');

    // Evitar que la página salte hacia abajo de golpe
    document.getElementById('tool').scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    console.error(err);
    alert('Ocurrió un error al procesar el PDF. Por favor intenta con otro archivo.');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      Aplicar numeración`;
  }
}



// ---- RESET ----
function resetTool() {
  state.fileList = [];
  state.pdfBytes = null;
  state.pdfJsDoc = null;
  state.totalPages = 0;
  state.currentPage = 1;
  fileInput.value = '';
  if (fileListEl) fileListEl.innerHTML = '';

  downloadPanel.classList.add('hidden');
  configPanel.classList.add('hidden');
  uploadZone.classList.remove('hidden');
}

function resetToUpload() {
  state.fileList = [];
  state.pdfBytes = null;
  state.pdfJsDoc = null;
  state.totalPages = 0;
  state.currentPage = 1;
  fileInput.value = '';
  if (fileListEl) fileListEl.innerHTML = '';

  downloadPanel.classList.add('hidden');
  configPanel.classList.add('hidden');
  uploadZone.classList.remove('hidden');
}

// ---- UTILS ----
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const int = parseInt(hex, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

// ---- SCROLL ANIMATIONS (IntersectionObserver) ----
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('anim-fade-up');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.feature-card, .step, .section-title, .section-sub').forEach(el => {
  observer.observe(el);
});

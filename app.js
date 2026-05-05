const state = {
  dlr: createEmptyFileState(),
  blast: createEmptyFileState(),
  results: [],
  filteredResults: []
};

const els = {
  dlrInput: document.getElementById("dlrInput"),
  blastInput: document.getElementById("blastInput"),
  dlrMeta: document.getElementById("dlrMeta"),
  blastMeta: document.getElementById("blastMeta"),
  dlrRows: document.getElementById("dlrRows"),
  blastRows: document.getElementById("blastRows"),
  matchCount: document.getElementById("matchCount"),
  resultList: document.getElementById("resultList"),
  resultLimitLabel: document.getElementById("resultLimitLabel"),
  searchResults: document.getElementById("searchResults"),
  downloadResults: document.getElementById("downloadResults"),
  copyResults: document.getElementById("copyResults"),
  resetAll: document.getElementById("resetAll"),
  messageBox: document.getElementById("messageBox"),
  overallStatus: document.getElementById("overallStatus")
};

const columnAliases = {
  r1: ["r1", "r 1", "r_1", "r-1"],
  status: ["xc", "status", "delivery status", "delivery_status", "dlr status", "dlr_status"]
};

document.querySelectorAll(".dropzone").forEach((zone) => {
  const kind = zone.dataset.kind;
  const input = kind === "dlr" ? els.dlrInput : els.blastInput;
  const button = zone.querySelector("button");

  button.addEventListener("click", (event) => {
    event.preventDefault();
    input.click();
  });

  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });

  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("is-dragging");
  });

  zone.addEventListener("dragleave", () => {
    zone.classList.remove("is-dragging");
  });

  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragging");
    const file = event.dataTransfer.files?.[0];
    if (file) {
      loadCsvFile(file, kind);
    }
  });
});

els.dlrInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) {
    loadCsvFile(file, "dlr");
  }
});

els.blastInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) {
    loadCsvFile(file, "blast");
  }
});

els.searchResults.addEventListener("input", () => {
  renderResults();
});

els.resetAll.addEventListener("click", () => {
  state.dlr = createEmptyFileState();
  state.blast = createEmptyFileState();
  state.results = [];
  state.filteredResults = [];
  els.dlrInput.value = "";
  els.blastInput.value = "";
  els.searchResults.value = "";
  showMessage("", "info");
  updateUi();
});

els.downloadResults.addEventListener("click", () => {
  if (!state.results.length) return;
  const csv = ["R1", ...state.results.map(escapeCsvValue)].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "unique_delivered_r1.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
});

els.copyResults.addEventListener("click", async () => {
  if (!state.results.length) return;
  const text = state.results.join("\n");
  await copyText(text);
  showMessage("Copied R1 values to clipboard.", "info");
});

updateUi();

async function loadCsvFile(file, kind) {
  if (!isLikelyCsv(file)) {
    showMessage("Please choose a CSV file.", "error");
    return;
  }

  try {
    const text = await file.text();
    const parsed = parseCsv(text);
    const r1Column = findColumn(parsed.headers, columnAliases.r1);
    const statusColumn = kind === "dlr" ? findColumn(parsed.headers, columnAliases.status) : null;

    if (!r1Column) {
      throw new Error(`${labelForKind(kind)} file needs an R1 column.`);
    }

    if (kind === "dlr" && !statusColumn) {
      throw new Error("DLR file needs a status column such as XC or Status.");
    }

    state[kind] = {
      fileName: file.name,
      rows: parsed.rows,
      headers: parsed.headers,
      r1Column,
      statusColumn,
      loadedAt: new Date()
    };

    showMessage("", "info");
    computeResults();
    updateUi();
  } catch (error) {
    state[kind] = createEmptyFileState();
    showMessage(error.message || "Could not read that CSV file.", "error");
    computeResults();
    updateUi();
  }
}

function computeResults() {
  state.results = [];

  if (!state.dlr.rows.length || !state.blast.rows.length) {
    return;
  }

  const blastValues = new Set(
    state.blast.rows
      .map((row) => cleanR1(row[state.blast.r1Column]))
      .filter(Boolean)
  );

  const seen = new Set();
  const matches = [];

  state.dlr.rows.forEach((row) => {
    const r1 = cleanR1(row[state.dlr.r1Column]);
    const status = row[state.dlr.statusColumn] || "";

    if (r1 && blastValues.has(r1) && isDeliveredStatus(status) && !seen.has(r1)) {
      seen.add(r1);
      matches.push(r1);
    }
  });

  state.results = matches;
}

function updateUi() {
  updateDropzone("dlr");
  updateDropzone("blast");

  els.dlrRows.textContent = state.dlr.rows.length.toLocaleString();
  els.blastRows.textContent = state.blast.rows.length.toLocaleString();
  els.matchCount.textContent = state.results.length.toLocaleString();

  const ready = state.dlr.rows.length > 0 && state.blast.rows.length > 0;
  const hasResults = state.results.length > 0;
  els.downloadResults.disabled = !hasResults;
  els.copyResults.disabled = !hasResults;
  els.overallStatus.innerHTML = `<span class="status-dot"></span>${ready ? "Processed" : "Ready"}`;

  renderResults();
}

function updateDropzone(kind) {
  const zone = document.querySelector(`.dropzone[data-kind="${kind}"]`);
  const meta = kind === "dlr" ? els.dlrMeta : els.blastMeta;
  const data = state[kind];
  zone.classList.toggle("has-file", data.rows.length > 0);

  if (!data.rows.length) {
    meta.textContent = "No file selected";
    return;
  }

  const pieces = [
    data.fileName,
    `${data.rows.length.toLocaleString()} rows`,
    `R1: ${data.r1Column}`
  ];

  if (data.statusColumn) {
    pieces.push(`Status: ${data.statusColumn}`);
  }

  meta.textContent = pieces.join(" | ");
}

function renderResults() {
  const query = els.searchResults.value.trim().toLowerCase();
  state.filteredResults = query
    ? state.results.filter((item) => item.toLowerCase().includes(query))
    : state.results;

  const visible = state.filteredResults.slice(0, 400);
  els.resultLimitLabel.textContent = state.filteredResults.length
    ? `Showing ${visible.length.toLocaleString()} of ${state.filteredResults.length.toLocaleString()}`
    : "Showing 0";

  els.resultList.replaceChildren();

  if (!state.dlr.rows.length || !state.blast.rows.length) {
    els.resultList.appendChild(createEmptyState("Waiting for both files", "The extracted R1 list will appear here."));
    return;
  }

  if (!state.results.length) {
    els.resultList.appendChild(createEmptyState("No matches found", "Check that the R1 and status columns contain matching delivered records."));
    return;
  }

  if (!visible.length) {
    els.resultList.appendChild(createEmptyState("No search results", "Try another R1 value."));
    return;
  }

  const fragment = document.createDocumentFragment();
  visible.forEach((value, index) => {
    const row = document.createElement("div");
    row.className = "result-row";

    const rowIndex = document.createElement("span");
    rowIndex.className = "row-index";
    rowIndex.textContent = String(index + 1).padStart(2, "0");

    const rowValue = document.createElement("span");
    rowValue.className = "row-value";
    rowValue.textContent = value;
    rowValue.title = value;

    row.append(rowIndex, rowValue);
    fragment.appendChild(row);
  });

  els.resultList.appendChild(fragment);
}

function createEmptyState(title, body) {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  wrapper.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v18"></path>
      <path d="M5 8h14"></path>
      <path d="M7 13h10"></path>
      <path d="M9 18h6"></path>
    </svg>
    <h3></h3>
    <p></p>
  `;
  wrapper.querySelector("h3").textContent = title;
  wrapper.querySelector("p").textContent = body;
  return wrapper;
}

function createEmptyFileState() {
  return {
    fileName: "",
    rows: [],
    headers: [],
    r1Column: "",
    statusColumn: "",
    loadedAt: null
  };
}

function parseCsv(text) {
  const cleanText = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(cleanText);
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < cleanText.length; index += 1) {
    const char = cleanText[index];
    const next = cleanText[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((item) => item.some((cell) => String(cell).trim() !== ""));
  if (!nonEmptyRows.length) {
    throw new Error("The CSV file is empty.");
  }

  const headers = nonEmptyRows[0].map((header, index) => {
    const trimmed = String(header).trim();
    return trimmed || `Column ${index + 1}`;
  });

  const dataRows = nonEmptyRows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = String(cells[index] ?? "").trim();
    });
    return obj;
  });

  return {
    headers,
    rows: dataRows.filter((rowItem) => Object.values(rowItem).some(Boolean))
  };
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const options = [",", ";", "\t"];
  return options
    .map((delimiter) => ({
      delimiter,
      count: firstLine.split(delimiter).length - 1
    }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function findColumn(headers, aliases) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  return headers.find((header) => normalizedAliases.has(normalizeHeader(header))) || "";
}

function normalizeHeader(header) {
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function cleanR1(value) {
  return String(value ?? "").trim();
}

function isDeliveredStatus(value) {
  const status = String(value ?? "").trim().toLowerCase();
  if (!status) return false;
  if (/undeliver|not delivered|failed|failure|reject|expired|pending|blocked/.test(status)) {
    return false;
  }
  return /delivered|deliverd|delivrd|success|sent/.test(status);
}

function isLikelyCsv(file) {
  const name = file.name.toLowerCase();
  return name.endsWith(".csv") || file.type === "text/csv" || file.type === "application/vnd.ms-excel";
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function labelForKind(kind) {
  return kind === "dlr" ? "DLR" : "Blast";
}

function showMessage(message, type) {
  if (!message) {
    els.messageBox.classList.add("hidden");
    els.messageBox.textContent = "";
    return;
  }

  els.messageBox.textContent = message;
  els.messageBox.classList.toggle("error", type === "error");
  els.messageBox.classList.remove("hidden");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

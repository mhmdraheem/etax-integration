const includeVATDefault = false;
const vatRate = 14;
const maxReceiptsPerFile = 500;
const maxFilesPerZip = 100;
const maxJsonBytes = 2560 * 1024;
const maxZipBytes = 25 * 1024 * 1024;

const receiptTemplate = {
  "receipts": [
    {
      "header": {
        "dateTimeIssued": "2026-05-24T23:00:00Z",
        "receiptNumber": "{{receiptNumber1}}",
        "uuid": "{{receiptUuid1}}",
        "previousUUID": "",
        "referenceOldUUID": "",
        "currency": "EGP"
      },
      "documentType": {
        "receiptType": "S",
        "typeVersion": "1.2"
      },
      "seller": {
        "rin": "776878123",
        "companyTradeName": "محمد عبدالباسط عبدالرحمن عبدالرحيم",
        "branchCode": "0",
        "branchAddress": {
          "country": "EG",
          "governate": "Giza",
          "regionCity": "6 October City (1)",
          "street": "سكن مصر اكتوبر",
          "buildingNumber": "93"
        },
        "deviceSerialNumber": "",
        "activityCode": "4791"
      },
      "buyer": { "type": "P" },
      "itemData": [],
      "totalSales": 0,
      "netAmount": 0,
      "totalAmount": 0,
      "paymentMethod": "C"
    }
  ]
};

const returnTemplate = {
  "receipts": [
    {
      "header": {
        "dateTimeIssued": "2026-05-24T23:00:00Z",
        "receiptNumber": "{{receiptNumber1}}",
        "uuid": "{{returnreceiptUuid1}}",
        "previousUUID": "",
        "referenceOldUUID": "",
        "referenceUUID": "",
        "currency": "EGP"
      },
      "documentType": {
        "receiptType": "R",
        "typeVersion": "1.2"
      },
      "seller": {
        "rin": "776878123",
        "companyTradeName": "محمد عبدالباسط عبدالرحمن عبدالرحيم",
        "branchCode": "0",
        "branchAddress": {
          "country": "EG",
          "governate": "Giza",
          "regionCity": "6 October City (1)",
          "street": "سكن مصر اكتوبر",
          "buildingNumber": "93"
        },
        "deviceSerialNumber": "",
        "activityCode": "4791"
      },
      "buyer": { "type": "P" },
      "itemData": [],
      "totalSales": 0,
      "netAmount": 0,
      "totalAmount": 0,
      "paymentMethod": "C"
    }
  ]
};

const productMap = {
  "CHAR-200-BOX": {
    internalCode: "CHAR-200-BOX",
    description: "Fast Lighting incense Charcoal - 200 pieces",
    itemCode: "EG-776878123-CHAR200BOX",
    unitType: "PK"
  },
  "CHAR-100-BOX": {
    internalCode: "CHAR-100-BOX",
    description: "Fast Lighting incense Charcoal - 100 pieces",
    itemCode: "EG-776878123-CHAR100BOX",
    unitType: "BOX"
  },
  "CHAR-50-BUNDLE": {
    internalCode: "CHAR-50-BUNDLE",
    description: "Fast Lighting Incense Charcoal - 50 pieces",
    itemCode: "EG-776878123-CHAR50BUNDLE",
    unitType: "PK"
  },
  "CHAR-30-BUNDLE": {
    internalCode: "CHAR-30-BUNDLE",
    description: "Fast Lighting Incense Charcoal - 30 pieces",
    itemCode: "EG-776878123-CHAR30BUNDLE",
    unitType: "PK"
  },
  "CHAR-10-BUNDLE": {
    internalCode: "CHAR-10-BUNDLE",
    description: "Fast Lighting Incense Charcoal - 10 pieces",
    itemCode: "EG-776878123-CHAR10BUNDLE",
    unitType: "EA"
  }
};

const els = {
  csvFile: document.getElementById("csvFile"),
  envToggle: document.getElementById("envToggle"),
  envPreprodLabel: document.getElementById("envPreprodLabel"),
  envProdLabel: document.getElementById("envProdLabel"),
  fileName: document.getElementById("fileName"),
  includeOrders: document.getElementById("includeOrders"),
  includeReturns: document.getElementById("includeReturns"),
  ordersBody: document.getElementById("ordersBody"),
  totalCount: document.getElementById("totalCount"),
  salesValue: document.getElementById("salesValue"),
  returnsValue: document.getElementById("returnsValue"),
  jsonCount: document.getElementById("jsonCount"),
  statusText: document.getElementById("statusText"),
  viewFiles: document.getElementById("viewFiles"),
  downloadZip: document.getElementById("downloadZip"),
  jsonPreview: document.getElementById("jsonPreview"),
  copyJson: document.getElementById("copyJson"),
  selectAll: document.getElementById("selectAll"),
  sendEta: document.getElementById("sendEta"),
  submitModal: document.getElementById("submitModal"),
  modalRequest: document.getElementById("modalRequest"),
  modalResponse: document.getElementById("modalResponse"),
  modalStatus: document.getElementById("modalStatus"),
  exportResponse: document.getElementById("exportResponse"),
  sendModalBtn: document.getElementById("sendModalBtn"),
  closeModal: document.getElementById("closeModal"),
};

let csvText = "";
let csvRows = [];
let processed = [];
let checkedIndices = new Set(); // indices of rows ticked by the user
let submissionFiles = [];
let zipBlob = null;
let selectedIndex = -1;
let expanded = new Set();
let currentEnv = "prod";
let lastEtaUUID = "";
const refUUIDs = new Map(); // keyed by group.key → manually entered referenceUUID per return receipt

async function fetchLastUUID() {
  els.statusText.textContent = "Fetching last submitted UUID from ETA…";
  try {
    const res = await fetch(`/proxy/receipts/recent?env=${encodeURIComponent(currentEnv)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    if (!body.uuid) throw new Error("No UUID returned");
    lastEtaUUID = body.uuid;
  } catch (err) {
    lastEtaUUID = "";
    els.statusText.textContent = `Could not fetch last UUID: ${err.message}`;
  }
}

function getCheckedItems() {
  return processed.filter((_, i) => checkedIndices.has(i));
}

// Rebuild ZIP / submissionFiles from the currently checked rows and refresh UI.
function refreshCheckedOutputs() {
  const items = getCheckedItems();
  submissionFiles = splitSubmissionFiles(items);
  zipBlob = items.length ? createZip(submissionFiles) : null;
  renderSummary();
  updateButtons();
}

function updateSelectAllCheckbox() {
  if (!processed.length) { els.selectAll.checked = false; els.selectAll.indeterminate = false; return; }
  const n = checkedIndices.size;
  els.selectAll.indeterminate = n > 0 && n < processed.length;
  els.selectAll.checked = n === processed.length;
}
let envDeviceSerials = { preprod: "", prod: "" };

(async function loadDeviceSerials() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    envDeviceSerials.preprod = cfg.preprodSerial || "";
    envDeviceSerials.prod    = cfg.prodSerial    || "";
  } catch (e) {
    console.error("Could not load device config:", e.message);
  }
})();

class SourceJsonParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) throw new Error(`Unexpected text at position ${this.index}`);
    return value;
  }

  skipWhitespace() {
    while (/\s/.test(this.source[this.index])) this.index += 1;
  }

  parseValue() {
    this.skipWhitespace();
    const char = this.source[this.index];
    if (char === "\"") return { type: "primitive", raw: this.parseString() };
    if (char === "{") return this.parseObject();
    if (char === "[") return this.parseArray();
    return this.parseLiteral();
  }

  parseString() {
    this.index += 1;
    const start = this.index;
    let escaped = false;
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") {
        const raw = this.source.slice(start, this.index);
        this.index += 1;
        return raw;
      }
      this.index += 1;
    }
    throw new Error("Unterminated string value");
  }

  parseLiteral() {
    const start = this.index;
    while (this.index < this.source.length && !/[\s,\}\]]/.test(this.source[this.index])) this.index += 1;
    const raw = this.source.slice(start, this.index);
    if (!raw) throw new Error(`Expected value at position ${this.index}`);
    return { type: "primitive", raw };
  }

  parseObject() {
    this.index += 1;
    const props = [];
    this.skipWhitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return { type: "object", props };
    }
    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] !== "\"") throw new Error(`Expected property name at position ${this.index}`);
      const name = this.parseString();
      this.skipWhitespace();
      if (this.source[this.index] !== ":") throw new Error(`Expected ':' after ${name}`);
      this.index += 1;
      props.push({ name, value: this.parseValue() });
      this.skipWhitespace();
      const char = this.source[this.index];
      this.index += 1;
      if (char === "}") break;
      if (char !== ",") throw new Error(`Expected ',' or '}' at position ${this.index - 1}`);
    }
    return { type: "object", props };
  }

  parseArray() {
    this.index += 1;
    const items = [];
    this.skipWhitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return { type: "array", items };
    }
    while (true) {
      items.push(this.parseValue());
      this.skipWhitespace();
      const char = this.source[this.index];
      this.index += 1;
      if (char === "]") break;
      if (char !== ",") throw new Error(`Expected ',' or ']' at position ${this.index - 1}`);
    }
    return { type: "array", items };
  }
}

function serializeNode(node) {
  if (node.type === "primitive") return `"${node.raw}"`;
  if (node.type === "object") return node.props.map((prop) => serializeProperty(prop.name, prop.value)).join("");
  throw new Error("Array values must be serialized through their property name");
}

function serializeProperty(name, value) {
  const upperName = name.toUpperCase();
  if (value.type === "array") {
    return `"${upperName}"` + value.items.map((item) => `"${upperName}"${serializeNode(item)}`).join("");
  }
  return `"${upperName}"${serializeNode(value)}`;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return round2(value).toFixed(2);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function calculateUuid(receipt) {
  const clone = deepClone(receipt);
  clone.header.uuid = "";
  const normalized = serializeNode(new SourceJsonParser(JSON.stringify(clone)).parse());
  return sha256Hex(normalized);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values, rowIndex) => {
    const record = { __row: rowIndex + 2 };
    headers.forEach((header, index) => {
      record[header] = (values[index] || "").trim();
    });
    return record;
  });
}


function datePartsFromCsv(value) {
  if (!value) return "";
  const trimmed = value.trim();
  let match = trimmed.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3])
    };
  }
  match = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (match) {
    return {
      year: Number(match[3]),
      month: Number(match[1]),
      day: Number(match[2])
    };
  }
  return null;
}

function dateToEta(value, offsetMinutes = 0, isReturn = false) {
  const parts = datePartsFromCsv(value);
  if (!parts) return "";
  let date;
  if(isReturn) 
    date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 20, offsetMinutes, 0));
  else 
    date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 19, offsetMinutes, 0));
  return date.toISOString().replace(".000Z", "Z");
}


function requiredColumns() {
  return [
    "Document Type",
    "Partner SKU",
    "Price Including VAT (Document Currency)",
    "Document Date",
    "Invoice Nr",
    "Invoice Line Nr",
    "Credit Note Nr",
    "Credit Note Line Nr"
  ];
}

function groupRecords(records) {
  const groups = new Map();
  records.forEach((row) => {
    const docType = (row["Document Type"] || "").toLowerCase();
    const isReturn = docType === "creditnote";
    const number = isReturn ? row["Credit Note Nr"] : row["Invoice Nr"];
    const key = `${isReturn ? "R" : "S"}:${number || `row-${row.__row}`}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        isReturn,
        number,
        sourceInvoice: row["Invoice Nr"] || "",
        sourceDoc: row["Source Doc Nr"] || "",
        date: row["Document Date"] || "",
        rows: [],
        reasons: []
      });
    }
    groups.get(key).rows.push(row);
  });
  return [...groups.values()].sort((a, b) => {
    const da = datePartsFromCsv(a.date);
    const db = datePartsFromCsv(b.date);
    const ta = da ? Date.UTC(da.year, da.month - 1, da.day) : Number.MAX_SAFE_INTEGER;
    const tb = db ? Date.UTC(db.year, db.month - 1, db.day) : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
}

function mergeLines(rows, includeVat) {
  const lineGroups = new Map();
  rows.forEach((row) => {
    const sku = row["Partner SKU"] || "";
    const price = parseFloat((row["Price Including VAT (Document Currency)"] || "0").replace(/,/g, ""));
    const key = `${sku}|${Number.isFinite(price) ? price : "bad"}`;
    if (!lineGroups.has(key)) {
      lineGroups.set(key, { sku, unitGross: Number.isFinite(price) ? price : 0, quantity: 0, grossTotal: 0, rows: [] });
    }
    const line = lineGroups.get(key);
    line.quantity += 1;
    line.grossTotal += Number.isFinite(price) ? price : 0;
    line.rows.push(row);
  });

  return [...lineGroups.values()].map((line) => {
    const product = productMap[line.sku];
    const grossTotal = round2(line.grossTotal);
    const unitGross = round2(grossTotal / line.quantity);
    const netTotal = includeVat ? round2(grossTotal / (1 + vatRate / 100)) : grossTotal;
    const unitNet = round2(netTotal / line.quantity);
    const vatAmount = includeVat ? round2(grossTotal - netTotal) : 0;
    const item = {
      internalCode: product ? product.internalCode : line.sku,
      description: product ? product.description : (line.rows[0]["Description"] || line.sku || "Unknown product"),
      itemType: "EGS",
      itemCode: product ? currentEnv === 'preprod'? 'EG-776878123-776878123-CHAR100BOX': product.itemCode : "",
      unitType: product ? product.unitType : "EA",
      quantity: line.quantity,
      unitPrice: includeVat ? unitNet : unitGross,
      netSale: netTotal,
      totalSale: netTotal,
      total: grossTotal
    };
    if (includeVat) {
      item.taxableItems = [{ taxType: "T1", amount: vatAmount, subType: "V009", rate: vatRate }];
    }
    return { ...line, item, netTotal, grossTotal, vatAmount };
  });
}

function collectReasons(group, lines, receiptIndex) {
  const reasons = [];
  if (!group.number) reasons.push(group.isReturn ? "Missing Credit Note Nr" : "Missing Invoice Nr");
  if (!dateToEta(group.date)) reasons.push("Missing or invalid Document Date");
  group.rows.forEach((row) => {
    requiredColumns().forEach((column) => {
      if (row[column] === undefined) reasons.push(`Missing column: ${column}`);
    });
    if (!row["Partner SKU"]) reasons.push(`Row ${row.__row}: missing Partner SKU`);
    else if (!productMap[row["Partner SKU"]]) reasons.push(`Row ${row.__row}: unmapped SKU ${row["Partner SKU"]}`);
    const price = parseFloat((row["Price Including VAT (Document Currency)"] || "").replace(/,/g, ""));
    if (!Number.isFinite(price)) reasons.push(`Row ${row.__row}: invalid price`);
  });
  if (group.isReturn && !refUUIDs.get(group.key)) {
    reasons.push(`Original sale receipt not found in ETA for invoice ${group.sourceInvoice || group.number} — it may not have been submitted yet`);
  }
  if (!lines.length) reasons.push("No item lines found");
  return [...new Set(reasons)];
}

async function buildReceipts(records, includeVat, startingPrevUUID = "") {
  let previousUUID = startingPrevUUID;
  const receiptIndex = {};
  const groups = groupRecords(records);
  const receipts = [];

  for (const [groupIndex, group] of groups.entries()) {
    const lines = mergeLines(group.rows, includeVat);
    const template = group.isReturn ? returnTemplate : receiptTemplate;
    const receipt = deepClone(template.receipts[0]);
    const totalSales = round2(lines.reduce((sum, line) => sum + line.netTotal, 0));
    const totalAmount = round2(lines.reduce((sum, line) => sum + line.grossTotal, 0));
    const taxTotal = round2(lines.reduce((sum, line) => sum + line.vatAmount, 0));

    receipt.header.dateTimeIssued = dateToEta(group.date, groupIndex, group.isReturn);
    receipt.header.receiptNumber = group.number;
    receipt.header.previousUUID = previousUUID;
    receipt.header.currency = "EGP";
    if (group.isReturn) {
      receipt.header.referenceUUID = refUUIDs.get(group.key) || receiptIndex[group.sourceDoc] || "";
    }
    receipt.documentType.receiptType = group.isReturn ? "R" : "S";
    receipt.seller.deviceSerialNumber = envDeviceSerials[currentEnv] || "";
    receipt.itemData = lines.map((line) => line.item);
    receipt.totalSales = totalSales;
    receipt.netAmount = totalSales;
    receipt.totalAmount = totalAmount;
    if (includeVat) {
      receipt.taxTotals = [{ taxType: "T1", amount: taxTotal }];
    } else {
      delete receipt.taxTotals;
    }
    receipt.header.uuid = await calculateUuid(receipt); // UUID computed after deviceSerialNumber is set
    previousUUID = receipt.header.uuid;

    const reasons = collectReasons(group, lines, receiptIndex);
    receipts.push({
      group,
      receipt,
      lines,
      reasons,
      type: group.isReturn ? "Return" : "Order",
      amount: totalAmount
    });
  }
  return receipts;
}

function splitSubmissionFiles(items) {
  const files = [];
  let current = [];
  for (const item of items) {
    const candidate = [...current, item.receipt];
    const text = JSON.stringify({ receipts: candidate }, null, 2);
    const bytes = new TextEncoder().encode(text).length;
    if ((current.length >= maxReceiptsPerFile || bytes > maxJsonBytes) && current.length) {
      files.push(current);
      current = [item.receipt];
    } else {
      current = candidate;
    }
  }
  if (current.length) files.push(current);
  return files.slice(0, maxFilesPerZip).map((receipts, index) => {
    const batch = String(index + 1).padStart(3, "0");
    return {
      name: `submission-${batch}.json`,
      text: JSON.stringify({ receipts }, null, 2)
    };
  });
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function pushUint16(parts, value) {
  parts.push(value & 255, (value >>> 8) & 255);
}

function pushUint32(parts, value) {
  parts.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);
    const local = [];
    pushUint32(local, 0x04034b50);
    pushUint16(local, 20);
    pushUint16(local, 0);
    pushUint16(local, 0);
    pushUint16(local, now.dosTime);
    pushUint16(local, now.dosDate);
    pushUint32(local, crc);
    pushUint32(local, data.length);
    pushUint32(local, data.length);
    pushUint16(local, nameBytes.length);
    pushUint16(local, 0);
    localParts.push(new Uint8Array(local), nameBytes, data);

    const central = [];
    pushUint32(central, 0x02014b50);
    pushUint16(central, 20);
    pushUint16(central, 20);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, now.dosTime);
    pushUint16(central, now.dosDate);
    pushUint32(central, crc);
    pushUint32(central, data.length);
    pushUint32(central, data.length);
    pushUint16(central, nameBytes.length);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint32(central, 0);
    pushUint32(central, offset);
    centralParts.push(new Uint8Array(central), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = [];
  pushUint32(end, 0x06054b50);
  pushUint16(end, 0);
  pushUint16(end, 0);
  pushUint16(end, files.length);
  pushUint16(end, files.length);
  pushUint32(end, centralSize);
  pushUint32(end, offset);
  pushUint16(end, 0);
  return new Blob([...localParts, ...centralParts, new Uint8Array(end)], { type: "application/zip" });
}

function shouldIncludeRow(row) {
  const docType = (row["Document Type"] || "").toLowerCase();
  if (docType === "invoice") return els.includeOrders.checked;
  if (docType === "creditnote") return els.includeReturns.checked;
  return false;
}


function renderTable() {
  if (!processed.length) {
    els.ordersBody.innerHTML = `<tr><td colspan="9"><div class="empty">No receipts were generated.</div></td></tr>`;
    return;
  }
  els.ordersBody.innerHTML = processed.map((item, index) => {
    const rowClass = item.group.isReturn ? "return-row" : "sale-row";
    const issueClass = item.reasons.length ? " issue-row" : "";
    const selected = index === selectedIndex ? " selected" : "";
    const isExpanded = expanded.has(index);
    const isChecked = checkedIndices.has(index);
    const warning = item.reasons.length ? `<span class="alert" title="${escapeHtml(item.reasons.join("\n"))}">!</span>` : "";
    const lines = isExpanded ? `
      <tr class="line-details">
        <td colspan="9">
          <div class="line-box">
            <table class="line-grid">
              <thead><tr><th>SKU</th><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th><th>Item code</th></tr></thead>
              <tbody>
                ${item.lines.map((line) => `
                  <tr>
                    <td class="mono">${escapeHtml(line.sku)}</td>
                    <td>${escapeHtml(line.item.description)}</td>
                    <td class="num">${line.item.quantity}</td>
                    <td class="num">${money(line.item.unitPrice)}</td>
                    <td class="num">${money(line.item.total)}</td>
                    <td class="mono">${escapeHtml(line.item.itemCode || "Missing")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </td>
      </tr>` : "";
    const refUuidRow = "";
    return `
      <tr class="${rowClass}${issueClass}${selected}" data-index="${index}">
        <td class="row-check"><input type="checkbox" data-action="check" data-index="${index}" ${isChecked ? "checked" : ""} aria-label="Select row"></td>
        <td><button class="toggle" type="button" data-action="expand" data-index="${index}" aria-label="Expand row">${isExpanded ? "v" : ">"}</button></td>
        <td class="mono">${escapeHtml(item.group.number || "Missing")}</td>
        <td class="mono">${escapeHtml(item.group.sourceDoc || "Missing")}</td>
        <td>${item.type}</td>
        <td class="num">${item.lines.length}x${item.lines.reduce((sum, line) => sum + line.item.quantity, 0)}</td>
        <td class="num">${money(item.amount)}</td>
        <td class="date-cell">${escapeHtml(item.receipt.header.dateTimeIssued || "Missing")}</td>
        <td>${warning}</td>
      </tr>
      ${refUuidRow}
      ${lines}
    `;
  }).join("");
}

function renderSummary() {
  const items = getCheckedItems();
  const orderCount = items.filter((item) => !item.group.isReturn).length;
  const returnCount = items.filter((item) => item.group.isReturn).length;
  const sales = items.filter((item) => !item.group.isReturn).reduce((sum, item) => sum + item.amount, 0);
  const returns = items.filter((item) => item.group.isReturn).reduce((sum, item) => sum + item.amount, 0);
  const selLabel = checkedIndices.size < processed.length && processed.length > 0
    ? ` (${checkedIndices.size}/${processed.length})`
    : "";
  els.totalCount.textContent = `${orderCount} Receipts, ${returnCount} Returns${selLabel}`;
  els.salesValue.textContent = money(sales);
  els.returnsValue.textContent = money(returns);
  els.jsonCount.textContent = String(submissionFiles.length);
}

function selectRow(index) {
  selectedIndex = index;
  if (processed[index]) {
    els.jsonPreview.textContent = JSON.stringify(processed[index].receipt, null, 2);
    els.copyJson.disabled = false;
  }
  renderTable();
}

function renderFilesPreview() {
  selectedIndex = -1;
  els.jsonPreview.textContent = submissionFiles.map((file) => `// ${file.name}\n${file.text}`).join("\n\n");
  els.copyJson.disabled = !submissionFiles.length;
  renderTable();
}

function updateButtons() {
  const hasChecked = getCheckedItems().length > 0;
  els.viewFiles.disabled = !submissionFiles.length;
  els.downloadZip.disabled = !zipBlob || !hasChecked;
  els.copyJson.disabled = !processed.length && !submissionFiles.length;
  els.sendEta.disabled = !submissionFiles.length;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function rebuildSelectedOutputs() {
  els.statusText.textContent = "Processing CSV...";
  if (!csvRows.length) throw new Error("The CSV file has no data rows.");
  const selectedRows = csvRows.filter(shouldIncludeRow);
  if (!selectedRows.length) throw new Error("Select Orders, Returns, or both before processing.");

  processed = await buildReceipts(selectedRows, includeVATDefault, lastEtaUUID);
  checkedIndices = new Set(processed.map((_, i) => i)); // select all by default
  submissionFiles = splitSubmissionFiles(processed);      // all checked = all processed
  zipBlob = processed.length ? createZip(submissionFiles) : null;
  const hasAlerts = processed.some((item) => item.reasons.length);
  selectedIndex = processed.length ? 0 : -1;
  expanded = new Set();
  renderTable();
  renderSummary();
  updateSelectAllCheckbox();
  if (processed.length) selectRow(0);
  updateButtons();

  if (zipBlob && zipBlob.size > maxZipBytes) {
    els.statusText.textContent = "ZIP is larger than 25 MB. Reduce the CSV size and process again.";
  } else if (hasAlerts) {
    els.statusText.textContent = `Showing ${processed.length} receipt(s) with ${processed.filter(i => i.reasons.length).length} alert(s) — fix before downloading.`;
  } else {
    els.statusText.textContent = `${processed.length} receipt(s) ready in ${submissionFiles.length} JSON file(s).`;
  }
}

function renderProcessingError(error) {
  processed = [];
  checkedIndices = new Set();
  submissionFiles = [];
  zipBlob = null;
  selectedIndex = -1;
  expanded = new Set();
  renderTable();
  renderSummary();
  updateButtons();
  els.jsonPreview.textContent = String(error.message || error);
  els.statusText.textContent = "Processing failed.";
}

// Auto-search ETA for the sale receipt UUID of each return row (called after CSV load / env change)
async function fetchReturnUUIDs(rows) {
  const seen    = new Set();
  const toFetch = [];
  for (const row of rows) {
    if ((row["Document Type"] || "").toLowerCase() !== "creditnote") continue;
    const creditNr  = row["Credit Note Nr"] || "";
    const invoiceNr = row["Invoice Nr"]     || "";
    const key = `R:${creditNr || `row-${row.__row}`}`;
    if (!invoiceNr || seen.has(key) || refUUIDs.has(key)) continue;
    seen.add(key);
    toFetch.push({ key, invoiceNr });
  }
  if (!toFetch.length) return;
  els.statusText.textContent = `Searching ETA for ${toFetch.length} return receipt UUID(s)…`;
  await Promise.all(toFetch.map(async ({ key, invoiceNr }) => {
    try {
      const res  = await fetch(`/proxy/receipts/search?invoiceNr=${encodeURIComponent(invoiceNr)}&env=${encodeURIComponent(currentEnv)}`);
      const body = await res.json();
      refUUIDs.set(key, body.uuid || "");
    } catch {
      refUUIDs.set(key, "");
    }
  }));
}

els.csvFile.addEventListener("change", async () => {
  const file = els.csvFile.files[0];
  if (!file) return;
  csvText = await file.text();
  els.fileName.textContent = file.name;
  csvRows = parseCsv(csvText);
  refUUIDs.clear();
  await fetchLastUUID();
  await fetchReturnUUIDs(csvRows);
  try {
    await rebuildSelectedOutputs();
  } catch (error) {
    renderProcessingError(error);
  }
});

els.includeOrders.addEventListener("change", async () => {
  if (!csvRows.length) {
    els.statusText.textContent = "Ready.";
    return;
  }
  try {
    await rebuildSelectedOutputs();
  } catch (error) {
    renderProcessingError(error);
  }
});
els.includeReturns.addEventListener("change", async () => {
  if (!csvRows.length) {
    els.statusText.textContent = "Ready.";
    return;
  }
  try {
    await rebuildSelectedOutputs();
  } catch (error) {
    renderProcessingError(error);
  }
});




els.envToggle.addEventListener("change", async () => {
  currentEnv = els.envToggle.checked ? "prod" : "preprod";
  updateEnvDisplay();
  if (csvRows.length) {
    refUUIDs.clear();
    await fetchLastUUID();
    await fetchReturnUUIDs(csvRows);
    try { await rebuildSelectedOutputs(); } catch (error) { renderProcessingError(error); }
  }
});

function updateEnvDisplay() {
  const isProd = currentEnv === "prod";
  els.envPreprodLabel.classList.toggle("env-active", !isProd);
  els.envPreprodLabel.classList.remove("env-prod-active");
  els.envProdLabel.classList.toggle("env-active", isProd);
  els.envProdLabel.classList.toggle("env-prod-active", isProd);

}
updateEnvDisplay();
els.viewFiles.addEventListener("click", renderFilesPreview);
els.downloadZip.addEventListener("click", () => {
  if (zipBlob) downloadBlob(zipBlob, `noon-eta-submissions-${els.fileName.textContent.replace('.csv', '')}.zip`);
});
els.copyJson.addEventListener("click", () => navigator.clipboard.writeText(els.jsonPreview.textContent));
// Row checkbox toggles
els.ordersBody.addEventListener("change", (event) => {
  const checkbox = event.target.closest("input[data-action='check']");
  if (!checkbox) return;
  const index = Number(checkbox.dataset.index);
  if (checkbox.checked) checkedIndices.add(index);
  else checkedIndices.delete(index);
  refreshCheckedOutputs();
  updateSelectAllCheckbox();
});

// Select-all header checkbox
els.selectAll.addEventListener("change", () => {
  if (els.selectAll.checked) {
    checkedIndices = new Set(processed.map((_, i) => i));
  } else {
    checkedIndices = new Set();
  }
  renderTable();
  refreshCheckedOutputs();
  updateSelectAllCheckbox();
});

els.ordersBody.addEventListener("click", (event) => {
  const selectedText = window.getSelection ? window.getSelection().toString() : "";
  if (selectedText.trim()) return;

  // Don't propagate checkbox clicks into row-select
  if (event.target.closest("input[data-action='check']")) return;

  const button = event.target.closest("button[data-action='expand']");
  if (button) {
    const index = Number(button.dataset.index);
    if (expanded.has(index)) expanded.delete(index);
    else expanded.add(index);
    renderTable();
    return;
  }
  const row = event.target.closest("tr[data-index]");
  if (row) selectRow(Number(row.dataset.index));
});

// ─── Submit to ETA modal ──────────────────────────────────────────────────────

let lastResponseData = null;

function openSubmitModal() {
  els.modalRequest.textContent = submissionFiles.map((f) => `// ${f.name}\n${f.text}`).join("\n\n");
  els.modalResponse.textContent = "Click Send to submit.";
  els.modalResponse.classList.add("modal-pre-muted");
  els.modalStatus.textContent = `${submissionFiles.length} file(s) ready — env: ${currentEnv}.`;
  els.exportResponse.disabled = true;
  els.sendModalBtn.disabled = false;
  lastResponseData = null;
  els.submitModal.removeAttribute("hidden");
}

function closeSubmitModal() {
  els.submitModal.setAttribute("hidden", "");
}

els.sendEta.addEventListener("click", openSubmitModal);
els.closeModal.addEventListener("click", closeSubmitModal);
els.submitModal.addEventListener("click", (e) => {
  if (e.target === els.submitModal) closeSubmitModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.submitModal.hasAttribute("hidden")) closeSubmitModal();
});

els.sendModalBtn.addEventListener("click", async () => {
  els.sendModalBtn.disabled = true;
  els.exportResponse.disabled = true;
  els.modalResponse.textContent = "";
  els.modalResponse.classList.remove("modal-pre-muted");
  lastResponseData = null;

  const results = [];
  for (let i = 0; i < submissionFiles.length; i++) {
    const file = submissionFiles[i];
    els.modalStatus.textContent = `Sending file ${i + 1}/${submissionFiles.length}: ${file.name}…`;
    try {
      const parsed = JSON.parse(file.text);
      const r = await fetch("/proxy/eta/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipts: parsed.receipts, env: currentEnv })
      });
      const data = await r.json();
      results.push({ file: file.name, ...data });
    } catch (err) {
      results.push({ file: file.name, ok: false, error: err.message });
    }
  }

  lastResponseData = results;
  els.modalResponse.textContent = results
    .map((r) => `// ${r.file}\n${JSON.stringify({ ok: r.ok, status: r.status, body: r.body ?? r.error }, null, 2)}`)
    .join("\n\n");

  const allOk = results.every((r) => r.ok);
  els.modalStatus.textContent = allOk
    ? `All ${results.length} submission(s) accepted by ETA.`
    : `Some submissions failed — review the responses.`;
  els.exportResponse.disabled = false;
  els.sendModalBtn.disabled = false;
});

els.exportResponse.addEventListener("click", () => {
  if (!lastResponseData) return;
  const text = JSON.stringify(lastResponseData, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  downloadBlob(blob, `eta-response-${ts}.json`);
});


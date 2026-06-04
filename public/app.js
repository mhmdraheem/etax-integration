const includeVATDefault = false;
const saveBatchLocally = true;
const vatRate = 14;
const maxReceiptsPerFile = 500;
const maxFilesPerZip = 100;
const maxJsonBytes = 2560 * 1024;
const maxZipBytes = 25 * 1024 * 1024;
const apiBase = "/api";

const receiptTemplate = {
  "receipts": [
    {
      "header": {
        "dateTimeIssued": "2026-05-24T23:00:00Z",
        "receiptNumber": "{{receiptNumber1}}",
        "uuid": "{{receiptUuid1}}",
        "previousUUID": "",
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
          "regionCity": "6th of October",
          "street": "Sakan Misr",
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
          "regionCity": "6th of October",
          "street": "Sakan Misr",
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
  "CHAR-200-BOX-VBUNDLE": {
    internalCode: "CHAR-200-BOX-VBUNDLE",
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
  sendSdk: document.getElementById("sendSdk"),
  jsonPreview: document.getElementById("jsonPreview"),
  copyJson: document.getElementById("copyJson"),
  sdkModal: document.getElementById("sdkModal"),
  closeSdkModal: document.getElementById("closeSdkModal"),
  sdkSpinner: document.getElementById("sdkSpinner"),
  sdkSummary: document.getElementById("sdkSummary"),
  sdkResponse: document.getElementById("sdkResponse")
};

let csvText = "";
let csvRows = [];
let processed = [];
let submissionFiles = [];
let zipBlob = null;
let selectedIndex = -1;
let expanded = new Set();
let currentBatchId = null;
let currentEnv = "preprod";

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

async function apiRequest(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `API request failed with ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function getHistory() {
  const history = await apiRequest("/history");
  return {
    batches: [],
    receiptIndex: history.receiptIndex || {},
    lastUUID: history.lastUUID || ""
  };
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

function dateToEta(value, offsetSeconds = 0) {
  const parts = datePartsFromCsv(value);
  if (!parts) return "";
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 23, 0, 0));
  return date.toISOString().replace(".000Z", "Z");
}

function dateSortValue(value) {
  const parts = datePartsFromCsv(value);
  if (!parts) return Number.MAX_SAFE_INTEGER;
  return Date.UTC(parts.year, parts.month - 1, parts.day);
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
    const dateDiff = dateSortValue(a.date) - dateSortValue(b.date);
    if (dateDiff) return dateDiff;
    const docDiff = (a.sourceDoc || "").localeCompare(b.sourceDoc || "");
    if (docDiff) return docDiff;
    if (a.isReturn !== b.isReturn) return a.isReturn ? 1 : -1;
    return a.rows[0].__row - b.rows[0].__row;
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
      itemCode: product ? product.itemCode : "",
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
  if (group.isReturn && !receiptIndex[group.sourceDoc]) {
    reasons.push("Return reference UUID not found in database history for this Source Doc Nr");
  }
  if (!lines.length) reasons.push("No item lines found");
  return [...new Set(reasons)];
}

async function buildReceipts(records, includeVat) {
  const history = await getHistory();
  let previousUUID = history.lastUUID || "";
  const receiptIndex = { ...history.receiptIndex };
  const groups = groupRecords(records);
  const receipts = [];

  for (const [groupIndex, group] of groups.entries()) {
    const lines = mergeLines(group.rows, includeVat);
    const template = group.isReturn ? returnTemplate : receiptTemplate;
    const receipt = deepClone(template.receipts[0]);
    const totalSales = round2(lines.reduce((sum, line) => sum + line.netTotal, 0));
    const totalAmount = round2(lines.reduce((sum, line) => sum + line.grossTotal, 0));
    const taxTotal = round2(lines.reduce((sum, line) => sum + line.vatAmount, 0));

    receipt.header.dateTimeIssued = dateToEta(group.date, groupIndex);
    receipt.header.receiptNumber = group.number;
    receipt.header.previousUUID = previousUUID;
    receipt.header.currency = "EGP";
    if (group.isReturn) {
      receipt.header.referenceUUID = receiptIndex[group.sourceDoc] || "";
    }
    receipt.documentType.receiptType = group.isReturn ? "R" : "S";
    receipt.itemData = lines.map((line) => line.item);
    receipt.totalSales = totalSales;
    receipt.netAmount = totalSales;
    receipt.totalAmount = totalAmount;
    if (includeVat) {
      receipt.taxTotals = [{ taxType: "T1", amount: taxTotal }];
    } else {
      delete receipt.taxTotals;
    }
    receipt.header.uuid = await calculateUuid(receipt);
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

async function saveBatch() {
  if (!processed.length || !saveBatchLocally) return;
  const batchNumber = `BATCH-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17)}-${crypto.randomUUID().slice(0, 8)}`;
  const batch = {
    batchNumber,
    createdAt: new Date().toISOString(),
    count: processed.length,
    receipts: processed.map((item) => ({
      number: item.group.number,
      type: item.type,
      sourceInvoice: item.group.sourceInvoice,
      sourceDoc: item.group.sourceDoc,
      request: item.receipt,
      uuid: item.receipt.header.uuid,
      status: item.reasons.length ? "invalid" : "valid",
      submitted: false
    }))
  };
  const result = await apiRequest("/batches", {
    method: "POST",
    body: JSON.stringify(batch)
  });
  currentBatchId = result.batchId;
  return result.batchId;
}

function renderTable() {
  if (!processed.length) {
    els.ordersBody.innerHTML = `<tr><td colspan="8"><div class="empty">No receipts were generated.</div></td></tr>`;
    return;
  }
  els.ordersBody.innerHTML = processed.map((item, index) => {
    const rowClass = item.group.isReturn ? "return-row" : "sale-row";
    const issueClass = item.reasons.length ? " issue-row" : "";
    const selected = index === selectedIndex ? " selected" : "";
    const isExpanded = expanded.has(index);
    const warning = item.reasons.length ? `<span class="alert" title="${escapeHtml(item.reasons.join("\n"))}">!</span>` : "";
    const lines = isExpanded ? `
      <tr class="line-details">
        <td colspan="8">
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
    return `
      <tr class="${rowClass}${issueClass}${selected}" data-index="${index}">
        <td><button class="toggle" type="button" data-action="expand" data-index="${index}" aria-label="Expand row">${isExpanded ? "v" : ">"}</button></td>
        <td class="mono">${escapeHtml(item.group.number || "Missing")}</td>
        <td class="mono">${escapeHtml(item.group.sourceDoc || "Missing")}</td>
        <td>${item.type}</td>
        <td class="num">${item.lines.length}x${item.lines.reduce((sum, line) => sum + line.item.quantity, 0)}</td>
        <td class="num">${money(item.amount)}</td>
        <td class="date-cell">${escapeHtml(item.receipt.header.dateTimeIssued || "Missing")}</td>
        <td>${warning}</td>
      </tr>
      ${lines}
    `;
  }).join("");
}

function renderSummary() {
  const orderCount = processed.filter((item) => !item.group.isReturn).length;
  const returnCount = processed.filter((item) => item.group.isReturn).length;
  const sales = processed.filter((item) => !item.group.isReturn).reduce((sum, item) => sum + item.amount, 0);
  const returns = processed.filter((item) => item.group.isReturn).reduce((sum, item) => sum + item.amount, 0);
  els.totalCount.textContent = `${orderCount} Receipts, ${returnCount} Returns`;
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
  const hasAlerts = processed.some((item) => item.reasons.length);
  els.viewFiles.disabled = !submissionFiles.length;
  els.downloadZip.disabled = !zipBlob || hasAlerts;
  els.sendSdk.disabled = !processed.length || !zipBlob;
  els.copyJson.disabled = !processed.length && !submissionFiles.length;
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

  processed = await buildReceipts(selectedRows, includeVATDefault);
  submissionFiles = splitSubmissionFiles(processed);
  zipBlob = createZip(submissionFiles);
  currentBatchId = null;
  const hasAlerts = processed.some((item) => item.reasons.length);
  selectedIndex = processed.length ? 0 : -1;
  expanded = new Set();
  renderTable();
  renderSummary();
  if (processed.length) selectRow(0);
  updateButtons();

  if (zipBlob.size > maxZipBytes) {
    els.statusText.textContent = "ZIP is larger than 25 MB. Reduce the CSV size and process again.";
  } else if (hasAlerts) {
    els.statusText.textContent = `Showing ${processed.length} selected receipt(s), but ZIP download is disabled until alerts are fixed.`;
  } else {
    els.statusText.textContent = `${processed.length} receipt(s) ready in ${submissionFiles.length} JSON file(s). Click "Send to SDK" to submit.`;
  }
}

function renderProcessingError(error) {
  processed = [];
  submissionFiles = [];
  zipBlob = null;
  selectedIndex = -1;
  currentBatchId = null;
  expanded = new Set();
  renderTable();
  renderSummary();
  updateButtons();
  els.jsonPreview.textContent = String(error.message || error);
  els.statusText.textContent = "Processing failed.";
}

els.csvFile.addEventListener("change", async () => {
  const file = els.csvFile.files[0];
  if (!file) return;
  csvText = await file.text();
  els.fileName.textContent = file.name;
  csvRows = parseCsv(csvText);
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

els.envToggle.addEventListener("change", () => {
  currentEnv = els.envToggle.checked ? "prod" : "preprod";
  updateEnvDisplay();
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
  if (zipBlob) downloadBlob(zipBlob, `noon-eta-submissions-${new Date().toISOString().slice(0, 10)}.zip`);
});
els.sendSdk.addEventListener("click", submitToSdk);
els.copyJson.addEventListener("click", () => navigator.clipboard.writeText(els.jsonPreview.textContent));
els.closeSdkModal.addEventListener("click", () => {
  els.sdkModal.hidden = true;
});
els.sdkModal.addEventListener("click", (event) => {
  if (event.target.classList.contains("modal-backdrop")) els.sdkModal.hidden = true;
});
els.ordersBody.addEventListener("click", (event) => {
  const selectedText = window.getSelection ? window.getSelection().toString() : "";
  if (selectedText.trim()) return;

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

async function submitToSdk() {
  if (currentEnv === "prod") {
    const confirmed = confirm(
      "WARNING: You are about to submit to the PRODUCTION (live) ETA environment.\n\n" +
      "Receipts submitted to production are recorded with the Egyptian Tax Authority and cannot be undone.\n\n" +
      "Proceed with production submission?"
    );
    if (!confirmed) return;
  }
  try {
    els.sdkModal.hidden = false;
    els.sdkSpinner.hidden = false;
    els.sdkSummary.textContent = `Submitting to ${currentEnv === "prod" ? "PRODUCTION" : "pre-production"}...`;
    els.sdkResponse.textContent = "";
    els.sendSdk.disabled = true;
    els.statusText.textContent = "Saving batch and sending to ETA...";
    if (!currentBatchId) {
      await saveBatch();
    }
    const result = await apiRequest(`/batches/${currentBatchId}/submit`, {
      method: "POST",
      body: JSON.stringify({ env: currentEnv })
    });
    els.sdkSummary.textContent = result.summary || `Batch status: ${result.status || "unknown"}`;
    els.sdkResponse.textContent = JSON.stringify(result.response || result, null, 2);
    els.statusText.textContent = `ETA submission finished (${currentEnv}): ${result.status || "unknown"}.`;
  } catch (error) {
    els.sdkSummary.textContent = "ETA submission failed.";
    els.sdkResponse.textContent = String(error.message || error);
    els.statusText.textContent = "ETA submission failed.";
  } finally {
    els.sdkSpinner.hidden = true;
    updateButtons();
  }
}

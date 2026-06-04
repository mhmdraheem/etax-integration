const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const mysql = require("mysql2/promise");

loadEnvFile(path.join(__dirname, "..", ".env"));

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "..", "public");
const importDir = path.join(__dirname, "..", "import");
const logsDir = path.join(__dirname, "..", "logs");
const databaseName = process.env.DB_NAME || "receipts_system";
let pool;

const envConfigs = {
  preprod: {
    idUrl: process.env.PREPROD_ID_URL || "https://id.preprod.eta.gov.eg",
    apiUrl: process.env.PREPROD_API_URL || "https://api.preprod.eta.gov.eg",
    clientId: process.env.PREPROD_CLIENT_ID || "",
    clientSecret: process.env.PREPROD_CLIENT_SECRET || "",
    deviceSerial: process.env.PREPROD_DEVICE_SERIAL || ""
  },
  prod: {
    idUrl: process.env.PROD_ID_URL || "https://id.eta.gov.eg",
    apiUrl: process.env.PROD_API_URL || "https://api.eta.gov.eg",
    clientId: process.env.PROD_CLIENT_ID || "",
    clientSecret: process.env.PROD_CLIENT_SECRET || "",
    deviceSerial: process.env.PROD_DEVICE_SERIAL || ""
  }
};

const pollIntervalMs = Number(process.env.SDK_POLL_INTERVAL_MS || 3000);
const pollMaxAttempts = Number(process.env.SDK_POLL_MAX_ATTEMPTS || 30);

const dbConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: databaseName,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true
};

// ─── Logger ──────────────────────────────────────────────────────────────────

function ensureLogsDir() {
  try {
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  } catch (_) { /* ignore */ }
}

function writeLog(level, event, data = {}) {
  const ts = new Date().toISOString();
  const entry = { ts, level, event, ...data };

  // Human-readable console
  const prefix = `[${ts}] ${level.toUpperCase().padEnd(5)} ${event}`;
  const extras = Object.keys(data).length ? data : "";
  if (level === "error") console.error(prefix, extras);
  else if (level === "warn") console.warn(prefix, extras);
  else console.log(prefix, extras);

  // Daily rolling file: logs/YYYY-MM-DD.log (NDJSON)
  const date = ts.slice(0, 10);
  try {
    ensureLogsDir();
    fs.appendFileSync(path.join(logsDir, `${date}.log`), JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {
    console.error("[logger] write failed:", e.message);
  }
}

const log = {
  info:  (event, data = {}) => writeLog("info",  event, data),
  warn:  (event, data = {}) => writeLog("warn",  event, data),
  error: (event, data = {}) => writeLog("error", event, data)
};

// ─── Express setup ────────────────────────────────────────────────────────────

app.use(express.json({ limit: "30mb" }));
app.use(express.static(publicDir));

// Log every inbound HTTP request + its final status code
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const data = { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start };
    if (req.body?.env) data.env = req.body.env;
    if (req.body?.batchNumber) data.batchNumber = req.body.batchNumber;
    log.info("http.request", data);
  });
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe database name: ${identifier}`);
  }
  return `\`${identifier}\``;
}

async function initializeDatabase() {
  log.info("db.init.start", { host: dbConfig.host, database: databaseName });
  try {
    const setupConnection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      multipleStatements: false
    });
    await setupConnection.query(
      `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await setupConnection.end();
    log.info("db.init.database_ready", { database: databaseName });
  } catch (error) {
    log.warn("db.init.create_db_failed", { message: error.message });
  }

  pool = mysql.createPool(dbConfig);
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS batches (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      batch_number VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL,
      receipt_count INT UNSIGNED NOT NULL DEFAULT 0,
      submissionID VARCHAR(128) NULL,
      status VARCHAR(32) NOT NULL,
      response JSON NULL,
      request_json JSON NOT NULL,
      inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_batches_batch_number (batch_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      batch_id BIGINT UNSIGNED NOT NULL,
      receipt_number VARCHAR(128) NOT NULL,
      document_type VARCHAR(16) NOT NULL,
      source_invoice VARCHAR(128) NULL,
      source_doc VARCHAR(128) NULL,
      uuid CHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'valid',
      submitted BOOLEAN NOT NULL DEFAULT FALSE,
      request_json JSON NOT NULL,
      inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_receipts_uuid (uuid),
      KEY idx_receipts_receipt_number (receipt_number),
      KEY idx_receipts_source_doc (source_doc),
      KEY idx_receipts_document_type (document_type),
      CONSTRAINT fk_receipts_batch
        FOREIGN KEY (batch_id) REFERENCES batches(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing("batches", "submissionID", "VARCHAR(128) NULL");
  await addColumnIfMissing("batches", "status", "VARCHAR(32) NOT NULL");
  await addColumnIfMissing("batches", "response", "JSON NULL");
  await addColumnIfMissing("receipts", "status", "VARCHAR(32) NOT NULL DEFAULT 'valid'");
  await addColumnIfMissing("receipts", "submitted", "BOOLEAN NOT NULL DEFAULT FALSE");

  log.info("db.schema_ready");
}

async function addColumnIfMissing(tableName, columnName, definition) {
  const [rows] = await pool.execute(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = :schemaName
        AND TABLE_NAME = :tableName
        AND COLUMN_NAME = :columnName
    `,
    { schemaName: databaseName, tableName, columnName }
  );
  if (Number(rows[0].count) === 0) {
    await pool.query(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`);
  }
}

function toMysqlDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return toMysqlDate();
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function parseJsonValue(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  return JSON.parse(value);
}

function getEnvConfig(env) {
  const cfg = envConfigs[env];
  if (!cfg) throw new Error(`Unknown environment: "${env}". Use "preprod" or "prod".`);
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error(`Environment "${env}" is not configured — missing client credentials in .env`);
  }
  return cfg;
}

// ─── ETA API calls ────────────────────────────────────────────────────────────

async function sdkRequest(url, options = {}) {
  const method = options.method || "GET";
  const isAuth = url.includes("/connect/token");

  // Log request — never log auth body (contains client_secret)
  log.info("eta.request", {
    method,
    url,
    ...(isAuth ? {} : { receiptCount: tryCountReceipts(options.body) })
  });

  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }

  // Log response — for auth just confirm token presence, never log the token value
  if (isAuth) {
    log.info("eta.response", {
      method, url,
      statusCode: response.status,
      ok: response.ok,
      tokenReceived: !!(body && body.access_token)
    });
  } else {
    log.info("eta.response", {
      method, url,
      statusCode: response.status,
      ok: response.ok,
      body
    });
  }

  if (!response.ok) {
    const message = body && (body.message || body.error) ? body.message || body.error : text;
    const err = new Error(message || `SDK request failed with ${response.status}`);
    log.error("eta.request_failed", { method, url, statusCode: response.status, message: err.message });
    throw err;
  }
  return body || {};
}

function tryCountReceipts(bodyStr) {
  try {
    const parsed = typeof bodyStr === "string" ? JSON.parse(bodyStr) : bodyStr;
    return Array.isArray(parsed?.receipts) ? parsed.receipts.length : undefined;
  } catch { return undefined; }
}

async function authenticateEnv(cfg) {
  log.info("eta.auth.start", { idUrl: cfg.idUrl });
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret
  });
  const response = await sdkRequest(`${cfg.idUrl}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const token = response.access_token;
  if (!token) throw new Error("Auth token not found in response");
  log.info("eta.auth.success", { idUrl: cfg.idUrl });
  return token;
}

function buildStatusUrl(cfg, submissionId) {
  return `${cfg.apiUrl}/api/v1/receiptsubmissions/${encodeURIComponent(submissionId)}/details?PageNo=1&PageSize=100`;
}

function extractSubmissionId(response) {
  return response.submissionId || "";
}

// Called on the 'Get Receipt Submission' poll response.
// status is "Valid", "Invalid", or "InProgress".
function isPendingStatus(response) {
  return String(response.status || "").toLowerCase() === "inprogress";
}

function extractBatchStatus(response) {
  if (Number(response.invalidReceiptsCount || 0) > 0) return "invalid";
  const normalized = String(response.status || "").toLowerCase();
  return normalized === "invalid" ? "invalid" : "valid";
}

// Builds a uuid → "valid"|"invalid" map from an ETA response.
// Works with both the submit response (acceptedDocuments/rejectedDocuments)
// and the poll response (receipts[] each with status "Valid"/"Invalid").
function buildReceiptStatusMap(response) {
  const map = new Map();
  // 'Get Receipt Submission' final response: receipts[] with uuid + status
  if (Array.isArray(response.receipts)) {
    for (const item of response.receipts) {
      if (item.uuid) {
        map.set(item.uuid, String(item.status || "").toLowerCase() === "invalid" ? "invalid" : "valid");
      }
    }
  }
  // Submit response: acceptedDocuments → valid, rejectedDocuments → invalid
  if (Array.isArray(response.acceptedDocuments)) {
    for (const item of response.acceptedDocuments) {
      if (item.uuid) map.set(item.uuid, "valid");
    }
  }
  if (Array.isArray(response.rejectedDocuments)) {
    for (const item of response.rejectedDocuments) {
      if (item.uuid) map.set(item.uuid, "invalid");
    }
  }
  return map;
}

function patchDeviceSerial(receipt, deviceSerial) {
  if (!deviceSerial) return receipt;
  const patched = JSON.parse(JSON.stringify(receipt));
  if (patched.seller) patched.seller.deviceSerialNumber = deviceSerial;
  return patched;
}

async function submitReceiptSet(cfg, receipts, token, type) {
  const url = `${cfg.apiUrl}/api/v1/receiptsubmissions`;
  const patched = receipts.map((r) => patchDeviceSerial(r, cfg.deviceSerial));

  log.info("eta.submit.start", { type, receiptCount: patched.length, url });
  const submitResponse = await sdkRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receipts: patched })
  });

  const submissionId = extractSubmissionId(submitResponse);
  if (!submissionId) throw new Error("SDK submission response did not include a submissionId");

  log.info("eta.submit.accepted", {
    type,
    submissionId,
    acceptedCount: submitResponse.acceptedDocuments?.length ?? 0,
    rejectedCount: submitResponse.rejectedDocuments?.length ?? 0
  });

  const finalResponse = await pollSubmission(cfg, submissionId, token, type);
  return { submissionId, submitResponse, finalResponse };
}

async function pollSubmission(cfg, submissionId, token, type) {
  log.info("eta.poll.start", { type, submissionId, maxAttempts: pollMaxAttempts });
  let latest = null;

  for (let attempt = 1; attempt <= pollMaxAttempts; attempt += 1) {
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    latest = await sdkRequest(buildStatusUrl(cfg, submissionId), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });

    const status = String(latest.status || "").toLowerCase();
    log.info("eta.poll.attempt", {
      type, submissionId, attempt,
      status: latest.status,
      receiptsCount: latest.receiptsCount,
      invalidReceiptsCount: latest.invalidReceiptsCount
    });

    if (!isPendingStatus(latest)) {
      log.info("eta.poll.done", {
        type, submissionId, attempt,
        finalStatus: latest.status,
        receiptsCount: latest.receiptsCount,
        invalidReceiptsCount: latest.invalidReceiptsCount
      });
      return latest;
    }
  }

  log.warn("eta.poll.max_attempts_reached", { type, submissionId, pollMaxAttempts });
  return latest;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/api/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    environments: {
      preprod: {
        configured: !!(envConfigs.preprod.clientId && envConfigs.preprod.clientSecret),
        deviceSerial: envConfigs.preprod.deviceSerial
      },
      prod: {
        configured: !!(envConfigs.prod.clientId && envConfigs.prod.clientSecret),
        deviceSerial: envConfigs.prod.deviceSerial
      }
    }
  });
});

app.get("/api/history", async (_req, res, next) => {
  try {
    const [lastRows] = await pool.query(
      "SELECT uuid FROM receipts WHERE status = 'valid' AND submitted = 1 ORDER BY id DESC LIMIT 1"
    );
    const [orderRows] = await pool.query(`
      SELECT receipt_number, source_doc, uuid
      FROM receipts
      WHERE document_type = 'Order'
      ORDER BY id ASC
    `);

    const receiptIndex = {};
    for (const row of orderRows) {
      if (row.receipt_number) receiptIndex[row.receipt_number] = row.uuid;
      if (row.source_doc) receiptIndex[row.source_doc] = row.uuid;
    }

    const lastUUID = lastRows[0] ? lastRows[0].uuid : "";
    log.info("history.fetched", { lastUUID: lastUUID || "(none)", indexSize: Object.keys(receiptIndex).length });
    res.json({ lastUUID, receiptIndex });
  } catch (error) {
    next(error);
  }
});

app.post("/api/batches", async (req, res, next) => {
  const batch = req.body;
  if (!batch || !batch.batchNumber || !Array.isArray(batch.receipts)) {
    res.status(400).json({ error: "Invalid batch payload" });
    return;
  }

  log.info("batch.save.start", { batchNumber: batch.batchNumber, receiptCount: batch.receipts.length });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [batchResult] = await connection.execute(
      `
        INSERT INTO batches (batch_number, created_at, receipt_count, status, request_json)
        VALUES (:batchNumber, :createdAt, :receiptCount, :status, :requestJson)
      `,
      {
        batchNumber: batch.batchNumber,
        createdAt: toMysqlDate(batch.createdAt),
        receiptCount: batch.receipts.length,
        status: batch.status || "pending",
        requestJson: JSON.stringify(batch)
      }
    );

    for (const receipt of batch.receipts) {
      await connection.execute(
        `
          INSERT INTO receipts (
            batch_id, receipt_number, document_type, source_invoice, source_doc,
            uuid, status, submitted, request_json
          )
          VALUES (
            :batchId, :receiptNumber, :documentType, :sourceInvoice, :sourceDoc,
            :uuid, :status, :submitted, :requestJson
          )
        `,
        {
          batchId: batchResult.insertId,
          receiptNumber: receipt.number || "",
          documentType: receipt.type || "",
          sourceInvoice: receipt.sourceInvoice || null,
          sourceDoc: receipt.sourceDoc || null,
          uuid: receipt.uuid || "",
          status: receipt.status || "valid",
          submitted: receipt.submitted ? 1 : 0,
          requestJson: JSON.stringify(receipt.request || {})
        }
      );
    }

    await connection.commit();
    log.info("batch.save.done", { batchId: batchResult.insertId, batchNumber: batch.batchNumber, receiptCount: batch.receipts.length });
    res.status(201).json({ ok: true, batchId: batchResult.insertId });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.post("/api/batches/:batchId/submit", async (req, res, next) => {
  const batchId = Number(req.params.batchId);
  if (!Number.isFinite(batchId)) {
    res.status(400).json({ error: "Invalid batch id" });
    return;
  }

  const env = req.body.env || "preprod";
  log.info("submission.start", { batchId, env });

  try {
    const cfg = getEnvConfig(env);

    const [batchRows] = await pool.execute("SELECT * FROM batches WHERE id = :batchId", { batchId });
    if (!batchRows.length) {
      res.status(404).json({ error: "Batch not found" });
      return;
    }

    const [receiptRows] = await pool.execute(
      "SELECT * FROM receipts WHERE batch_id = :batchId ORDER BY id ASC",
      { batchId }
    );
    if (!receiptRows.length) {
      res.status(400).json({ error: "Batch has no receipts" });
      return;
    }

    log.info("submission.receipts_loaded", {
      batchId,
      total: receiptRows.length,
      orders: receiptRows.filter((r) => r.document_type === "Order").length,
      returns: receiptRows.filter((r) => r.document_type === "Return").length
    });

    const orderReceipts = receiptRows
      .filter((row) => row.document_type === "Order")
      .map((row) => parseJsonValue(row.request_json));
    const returnReceipts = receiptRows
      .filter((row) => row.document_type === "Return")
      .map((row) => parseJsonValue(row.request_json));

    const token = await authenticateEnv(cfg);
    const submissions = [];

    if (orderReceipts.length) {
      submissions.push({ type: "Order", ...(await submitReceiptSet(cfg, orderReceipts, token, "Order")) });
    }
    if (returnReceipts.length) {
      submissions.push({ type: "Return", ...(await submitReceiptSet(cfg, returnReceipts, token, "Return")) });
    }

    const responsePayload = { env, submissions };
    const submissionID = submissions.map((s) => s.submissionId).filter(Boolean).join(",");
    const finalStatuses = submissions.map((s) => extractBatchStatus(s.finalResponse));
    const batchStatus = finalStatuses.some((s) => s === "invalid") ? "invalid" : "valid";

    log.info("submission.finalizing", { batchId, env, submissionID, batchStatus });
    await updateSubmissionResults(batchId, receiptRows, submissions, submissionID, batchStatus, responsePayload);

    const summary = buildSubmissionSummary(receiptRows.length, submissions, batchStatus);
    log.info("submission.done", { batchId, env, submissionID, batchStatus, summary });

    res.json({ ok: true, batchId, env, submissionID, status: batchStatus, summary, response: responsePayload });
  } catch (error) {
    log.error("submission.error", { batchId, env, message: error.message });
    next(error);
  }
});

async function updateSubmissionResults(batchId, receiptRows, submissions, submissionID, batchStatus, responsePayload) {
  const statusMap = new Map();
  for (const submission of submissions) {
    const partial = buildReceiptStatusMap(submission.finalResponse);
    for (const [key, value] of partial.entries()) statusMap.set(key, value);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let validCount = 0;
    let invalidCount = 0;

    for (const receipt of receiptRows) {
      const request = parseJsonValue(receipt.request_json);
      const receiptNumber = request.header && request.header.receiptNumber;
      const uuid = request.header && request.header.uuid;
      // Fall back to batch-level status if receipt isn't individually listed
      const status = statusMap.get(uuid) || statusMap.get(receiptNumber) || batchStatus;
      // Submitted = ETA accepted this specific receipt, regardless of other receipts in batch
      const submitted = status === "valid" ? 1 : 0;
      if (submitted) validCount++; else invalidCount++;
      await connection.execute(
        "UPDATE receipts SET status = :status, submitted = :submitted WHERE id = :id",
        { status, submitted, id: receipt.id }
      );
    }

    log.info("submission.receipts_updated", { batchId, validCount, invalidCount });

    await connection.execute(
      "UPDATE batches SET submissionID = :submissionID, status = :status, response = :response WHERE id = :batchId",
      { submissionID, status: batchStatus, response: JSON.stringify(responsePayload), batchId }
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function buildSubmissionSummary(receiptCount, submissions, batchStatus) {
  const submissionText = submissions
    .map((s) => `${s.type}: ${s.submissionId} (${extractBatchStatus(s.finalResponse)})`)
    .join("; ");
  return `Batch status: ${batchStatus}. Receipts: ${receiptCount}. ${submissionText}`;
}

app.delete("/api/history", async (_req, res, next) => {
  try {
    await pool.query("DELETE FROM batches");
    log.warn("history.cleared");
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  log.error("unhandled_error", { message: error.message, stack: error.stack });
  res.status(500).json({ error: error.message || "Server error" });
});

// ─── Startup import ───────────────────────────────────────────────────────────

async function importMobileReceipts() {
  if (!fs.existsSync(importDir)) return;
  const files = fs.readdirSync(importDir).filter((f) => f.endsWith(".json"));
  if (!files.length) return;

  const batchNumber = "mobile-import-2026-05-30";
  const [existing] = await pool.execute(
    "SELECT id FROM batches WHERE batch_number = :batchNumber",
    { batchNumber }
  );
  if (existing.length) {
    log.info("import.mobile.already_done", { batchNumber });
    return;
  }

  log.info("import.mobile.start", { files: files.length });
  const receipts = [];
  let submissionUuid = null;
  let batchDate = null;

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(importDir, file), "utf8"));
      const uuid = path.basename(file, ".json");
      const rawDoc = typeof data.rawDocument === "string" ? JSON.parse(data.rawDocument) : data.rawDocument;
      const receiptType = rawDoc?.documentType?.receiptType || data.receipt?.documentType?.receiptType || "S";
      if (!submissionUuid) submissionUuid = data.submissionUuid || null;
      if (!batchDate) batchDate = data.dateTimeReceived || null;
      receipts.push({
        uuid,
        receiptNumber: rawDoc?.header?.receiptNumber || "",
        documentType: receiptType === "R" ? "Return" : "Order",
        requestJson: rawDoc
      });
      log.info("import.mobile.file", { file, uuid, receiptNumber: rawDoc?.header?.receiptNumber });
    } catch (e) {
      log.warn("import.mobile.file_skip", { file, reason: e.message });
    }
  }

  if (!receipts.length) return;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [batchResult] = await connection.execute(
      `INSERT INTO batches (batch_number, created_at, receipt_count, submissionID, status, request_json)
       VALUES (:batchNumber, :createdAt, :receiptCount, :submissionId, 'valid', :requestJson)`,
      {
        batchNumber,
        createdAt: toMysqlDate(batchDate),
        receiptCount: receipts.length,
        submissionId: submissionUuid,
        requestJson: JSON.stringify({ source: "mobile-app-import" })
      }
    );
    for (const receipt of receipts) {
      await connection.execute(
        `INSERT IGNORE INTO receipts (batch_id, receipt_number, document_type, uuid, status, submitted, request_json)
         VALUES (:batchId, :receiptNumber, :documentType, :uuid, 'valid', 1, :requestJson)`,
        {
          batchId: batchResult.insertId,
          receiptNumber: receipt.receiptNumber,
          documentType: receipt.documentType,
          uuid: receipt.uuid,
          requestJson: JSON.stringify(receipt.requestJson)
        }
      );
    }
    await connection.commit();
    log.info("import.mobile.done", { batchNumber, batchId: batchResult.insertId, count: receipts.length, submissionUuid });
  } catch (error) {
    await connection.rollback();
    log.error("import.mobile.failed", { message: error.message });
  } finally {
    connection.release();
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

initializeDatabase()
  .then(ensureSchema)
  .then(importMobileReceipts)
  .then(() => {
    app.listen(port, () => {
      log.info("server.start", { port, url: `http://localhost:${port}` });
    });
  })
  .catch((error) => {
    log.error("server.boot_failed", { message: error.message, stack: error.stack });
    process.exit(1);
  });

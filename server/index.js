const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const mysql = require("mysql2/promise");

loadEnvFile(path.join(__dirname, "..", ".env"));

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "..", "public");
const databaseName = process.env.DB_NAME || "receipts_system";
let pool;
const sdkConfig = {
  authUrl: process.env.SDK_AUTH_URL || "",
  submitReceiptsUrl: process.env.SDK_SUBMIT_RECEIPTS_URL || "",
  submitReturnReceiptsUrl: process.env.SDK_SUBMIT_RETURN_RECEIPTS_URL || "",
  getSubmissionUrl: process.env.SDK_GET_SUBMISSION_URL || "",
  clientId: process.env.SDK_CLIENT_ID || "",
  clientSecret: process.env.SDK_CLIENT_SECRET || "",
  username: process.env.SDK_USERNAME || "",
  password: process.env.SDK_PASSWORD || "",
  authBody: process.env.SDK_AUTH_BODY || "",
  authTokenPath: process.env.SDK_AUTH_TOKEN_PATH || "access_token",
  pollIntervalMs: Number(process.env.SDK_POLL_INTERVAL_MS || 3000),
  pollMaxAttempts: Number(process.env.SDK_POLL_MAX_ATTEMPTS || 30)
};

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

app.use(express.json({ limit: "30mb" }));
app.use(express.static(publicDir));

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
  } catch (error) {
    console.warn(`Could not create database ${databaseName}. Continuing with configured database connection.`);
    console.warn(error.message);
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
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
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
  await addColumnIfMissing("batches", "status", "VARCHAR(32) NOT NULL DEFAULT 'pending'");
  await addColumnIfMissing("batches", "response", "JSON NULL");
  await addColumnIfMissing("receipts", "status", "VARCHAR(32) NOT NULL DEFAULT 'valid'");
  await addColumnIfMissing("receipts", "submitted", "BOOLEAN NOT NULL DEFAULT FALSE");
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

function getPathValue(object, pathExpression) {
  return String(pathExpression || "")
    .split(".")
    .filter(Boolean)
    .reduce((value, key) => (value && value[key] !== undefined ? value[key] : undefined), object);
}

function requireSdkConfig() {
  const missing = [];
  if (!sdkConfig.authUrl) missing.push("SDK_AUTH_URL");
  if (!sdkConfig.submitReceiptsUrl) missing.push("SDK_SUBMIT_RECEIPTS_URL");
  if (!sdkConfig.submitReturnReceiptsUrl) missing.push("SDK_SUBMIT_RETURN_RECEIPTS_URL");
  if (!sdkConfig.getSubmissionUrl) missing.push("SDK_GET_SUBMISSION_URL");
  if (missing.length) {
    throw new Error(`Missing SDK configuration: ${missing.join(", ")}`);
  }
}

function buildAuthBody() {
  if (sdkConfig.authBody) return JSON.parse(sdkConfig.authBody);
  return {
    clientId: sdkConfig.clientId,
    clientSecret: sdkConfig.clientSecret,
    username: sdkConfig.username,
    password: sdkConfig.password
  };
}

async function sdkRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    const message = body && (body.message || body.error) ? body.message || body.error : text;
    throw new Error(message || `SDK request failed with ${response.status}`);
  }
  return body || {};
}

async function authenticateSdk() {
  const authResponse = await sdkRequest(sdkConfig.authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAuthBody())
  });
  const token = getPathValue(authResponse, sdkConfig.authTokenPath);
  if (!token) throw new Error(`SDK auth token not found at ${sdkConfig.authTokenPath}`);
  return { token, authResponse };
}

function submissionStatusUrl(submissionId) {
  return sdkConfig.getSubmissionUrl.replaceAll("{submissionId}", encodeURIComponent(submissionId));
}

function extractSubmissionId(response) {
  return response.submissionId;
}

function extractBatchStatus(response) {
  if (Number(response.invalidReceiptsCount || 0) > 0) return "invalid";
  const raw = response.status || response.submissionStatus || response.overallStatus || response.validationStatus || "";
  const normalized = String(raw).toLowerCase();
  if (["valid", "accepted", "submitted", "completed", "success", "received"].includes(normalized)) return "valid";
  if (["invalid", "rejected", "failed", "error"].includes(normalized)) return "invalid";
  if (["pending", "inprogress", "in_progress", "processing"].includes(normalized)) return "pending";
  return normalized || "pending";
}

function isPendingStatus(response) {
  return extractBatchStatus(response) === "pending";
}

function collectReceiptResultItems(response) {
  const candidates = [
    response.receipts,
    response.receiptResults,
    response.documents,
    response.acceptedDocuments,
    response.rejectedDocuments,
    response.invalidReceipts,
    response.validReceipts
  ];
  return candidates.flatMap((items) => (Array.isArray(items) ? items : []));
}

function receiptResultKey(item) {
  return item.uuid || item.receiptUUID || item.receiptUuid || item.receiptNumber || item.internalId || item.id || "";
}

function receiptResultStatus(item, fallback) {
  const raw = item.status || item.validationStatus || item.state || fallback || "";
  const normalized = String(raw).toLowerCase();
  if (["valid", "accepted", "submitted", "completed", "success", "received"].includes(normalized)) return "valid";
  if (["invalid", "rejected", "failed", "error"].includes(normalized)) return "invalid";
  return normalized || fallback || "valid";
}

function buildReceiptStatusMap(response) {
  const map = new Map();
  for (const item of collectReceiptResultItems(response)) {
    const key = receiptResultKey(item);
    if (key) map.set(key, receiptResultStatus(item));
  }
  if (Array.isArray(response.rejectedDocuments)) {
    for (const item of response.rejectedDocuments) {
      const key = receiptResultKey(item);
      if (key) map.set(key, "invalid");
    }
  }
  if (Array.isArray(response.invalidReceipts)) {
    for (const item of response.invalidReceipts) {
      const key = receiptResultKey(item);
      if (key) map.set(key, "invalid");
    }
  }
  return map;
}

async function submitReceiptSet(url, receipts, token) {
  const submitResponse = await sdkRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ receipts })
  });
  const submissionId = extractSubmissionId(submitResponse);
  if (!submissionId) throw new Error("SDK submission response did not include a submissionID");
  const finalResponse = await pollSubmission(submissionId, token);
  return { submissionId, submitResponse, finalResponse };
}

async function pollSubmission(submissionId, token) {
  let latest = null;
  for (let attempt = 0; attempt < sdkConfig.pollMaxAttempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, sdkConfig.pollIntervalMs));
    }
    latest = await sdkRequest(submissionStatusUrl(submissionId), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!isPendingStatus(latest)) return latest;
  }
  return latest || { status: "pending" };
}

app.get("/api/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/history", async (_req, res, next) => {
  try {
    const [lastRows] = await pool.query("SELECT uuid FROM receipts ORDER BY id DESC LIMIT 1");
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

    res.json({
      lastUUID: lastRows[0] ? lastRows[0].uuid : "",
      receiptIndex
    });
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
            batch_id,
            receipt_number,
            document_type,
            source_invoice,
            source_doc,
            uuid,
            status,
            submitted,
            request_json
          )
          VALUES (
            :batchId,
            :receiptNumber,
            :documentType,
            :sourceInvoice,
            :sourceDoc,
            :uuid,
            :status,
            :submitted,
            :requestJson
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

  try {
    requireSdkConfig();
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

    const orderReceipts = receiptRows
      .filter((row) => row.document_type === "Order")
      .map((row) => parseJsonValue(row.request_json));
    const returnReceipts = receiptRows
      .filter((row) => row.document_type === "Return")
      .map((row) => parseJsonValue(row.request_json));

    const { token } = await authenticateSdk();
    const submissions = [];
    if (orderReceipts.length) {
      submissions.push({
        type: "Order",
        ...(await submitReceiptSet(sdkConfig.submitReceiptsUrl, orderReceipts, token))
      });
    }
    if (returnReceipts.length) {
      submissions.push({
        type: "Return",
        ...(await submitReceiptSet(sdkConfig.submitReturnReceiptsUrl, returnReceipts, token))
      });
    }

    const responsePayload = { submissions };
    const submissionID = submissions.map((submission) => submission.submissionId).filter(Boolean).join(",");
    const finalStatuses = submissions.map((submission) => extractBatchStatus(submission.finalResponse));
    const batchStatus = finalStatuses.some((status) => status === "invalid") ? "invalid" : finalStatuses.every((status) => status === "valid") ? "valid" : "pending";

    await updateSubmissionResults(batchId, receiptRows, submissions, submissionID, batchStatus, responsePayload);
    res.json({
      ok: true,
      batchId,
      submissionID,
      status: batchStatus,
      summary: buildSubmissionSummary(receiptRows.length, submissions, batchStatus),
      response: responsePayload
    });
  } catch (error) {
    next(error);
  }
});

async function updateSubmissionResults(batchId, receiptRows, submissions, submissionID, batchStatus, responsePayload) {
  const statusMap = new Map();
  for (const submission of submissions) {
    const partial = buildReceiptStatusMap(submission.finalResponse);
    for (const [key, value] of partial.entries()) statusMap.set(key, value);
  }

  const rejectedBatch = batchStatus === "invalid";
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const receipt of receiptRows) {
      const request = parseJsonValue(receipt.request_json);
      const receiptNumber = request.header && request.header.receiptNumber;
      const uuid = request.header && request.header.uuid;
      const status = statusMap.get(uuid) || statusMap.get(receiptNumber) || (rejectedBatch ? "valid" : batchStatus === "valid" ? "valid" : "pending");
      const submitted = batchStatus === "valid" && status === "valid" ? 1 : 0;
      await connection.execute(
        "UPDATE receipts SET status = :status, submitted = :submitted WHERE id = :id",
        { status, submitted, id: receipt.id }
      );
    }
    await connection.execute(
      "UPDATE batches SET submissionID = :submissionID, status = :status, response = :response WHERE id = :batchId",
      {
        submissionID,
        status: batchStatus,
        response: JSON.stringify(responsePayload),
        batchId
      }
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
  const submissionText = submissions.map((submission) => `${submission.type}: ${submission.submissionId} (${extractBatchStatus(submission.finalResponse)})`).join("; ");
  return `Batch status: ${batchStatus}. Receipts checked: ${receiptCount}. ${submissionText}`;
}

app.delete("/api/history", async (_req, res, next) => {
  try {
    await pool.query("DELETE FROM batches");
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Server error" });
});

initializeDatabase()
  .then(ensureSchema)
  .then(() => {
    app.listen(port, () => {
      console.log(`Receipt builder running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database schema");
    console.error(error);
    process.exit(1);
  });

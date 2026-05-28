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
}

function toMysqlDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return toMysqlDate();
  return date.toISOString().slice(0, 19).replace("T", " ");
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
        INSERT INTO batches (batch_number, created_at, receipt_count, request_json)
        VALUES (:batchNumber, :createdAt, :receiptCount, :requestJson)
      `,
      {
        batchNumber: batch.batchNumber,
        createdAt: toMysqlDate(batch.createdAt),
        receiptCount: batch.receipts.length,
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
            request_json
          )
          VALUES (
            :batchId,
            :receiptNumber,
            :documentType,
            :sourceInvoice,
            :sourceDoc,
            :uuid,
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

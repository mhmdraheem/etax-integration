const path   = require("node:path");
const fs     = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
//const noon   = require("./noon");

// Load .env — no extra dependency
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

const envConfigs = {
  preprod: {
    idUrl:        process.env.PREPROD_ID_URL  || "https://id.preprod.eta.gov.eg",
    apiUrl:       process.env.PREPROD_API_URL || "https://api.preprod.invoicing.eta.gov.eg",
    clientId:     process.env.PREPROD_CLIENT_ID,
    clientSecret: process.env.PREPROD_CLIENT_SECRET,
    posSerial:    process.env.PREPROD_DEVICE_SERIAL,
    posOsVersion: "android"
  },
  prod: {
    idUrl:        process.env.PROD_ID_URL  || "https://id.eta.gov.eg",
    apiUrl:       process.env.PROD_API_URL || "https://api.invoicing.eta.gov.eg",
    clientId:     process.env.PROD_CLIENT_ID,
    clientSecret: process.env.PROD_CLIENT_SECRET,
    posSerial:    process.env.PROD_DEVICE_SERIAL,
    posOsVersion: "windows"
  }
};

const app  = express();
const port = Number(process.env.PORT || 3000);

app.use(express.static(__dirname));

// ─── ETA auth helper ──────────────────────────────────────────────────────────

async function getEtaToken(cfg) {
  const res  = await fetch(`${cfg.idUrl}/connect/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      posserial:    cfg.posSerial,
      pososversion: cfg.posOsVersion
    },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     cfg.clientId,
      client_secret: cfg.clientSecret
    }).toString()
  });
  const text = await res.text();
  //console.log(`[eta-auth] status=${res.status} body=${text}`);
  if (!res.ok) throw new Error(`Auth failed (${res.status}): ${text}`);
  const { access_token } = JSON.parse(text);
  if (!access_token) throw new Error("No access_token in auth response");
  return access_token;
}

// ─── ETA — fetch last submitted receipt UUID ──────────────────────────────────

app.get("/proxy/receipts/recent", async (req, res) => {
  const env = req.query.env === "prod" ? "prod" : "preprod";
  const cfg = envConfigs[env];

  if (!cfg.clientId || !cfg.clientSecret) {
    return res.status(400).json({ error: `No credentials configured for "${env}" in .env` });
  }

  try {
    const token = await getEtaToken(cfg);

    const url  = `${cfg.apiUrl}/api/v1/receipts/recent?SortBy=DateTimeReceived&SortDir=Desc&PageNo=1&PageSize=1`;
    console.log(`[recent] GET ${url}`);
    const r    = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await r.text();
    //console.log(`[recent] status=${r.status} body=${text}`);
    if (!r.ok) throw new Error(`Receipts API failed (${r.status}): ${text}`);

    const uuid = JSON.parse(text).receipts?.[0]?.uuid;
    if (!uuid) throw new Error("No receipts found in ETA");

    res.json({ uuid });
  } catch (err) {
    const cause = err.cause ? String(err.cause) : "";
    console.error(`[recent] error: ${err.message}${cause ? ` | cause: ${cause}` : ""}`);
    res.status(500).json({ error: err.message, cause });
  }
});

// ─── ETA — search receipt by invoice number → return its UUID ─────────────────

app.get("/proxy/receipts/search", async (req, res) => {
  const env = req.query.env === "prod" ? "prod" : "preprod";
  const { invoiceNr } = req.query;

  if (!invoiceNr) return res.status(400).json({ error: "invoiceNr query param required" });

  const cfg = envConfigs[env];
  if (!cfg.clientId || !cfg.clientSecret) {
    return res.status(400).json({ error: `No credentials configured for "${env}" in .env` });
  }

  try {
    const token = await getEtaToken(cfg);

    const url  = `${cfg.apiUrl}/api/v1/receipts/search?FreeText=${encodeURIComponent(invoiceNr)}&PageNo=1&PageSize=1`;
    console.log(`[search] GET ${url}`);
    const r    = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await r.text();
    //console.log(`[search] status=${r.status} body=${text}`);
    if (!r.ok) throw new Error(`Search failed (${r.status}): ${text}`);

    const uuid = JSON.parse(text).receipts?.[0]?.uuid || null;
    console.log(`[search] invoiceNr=${invoiceNr} → uuid=${uuid}`);
    res.json({ uuid });
  } catch (err) {
    const cause = err.cause ? String(err.cause) : "";
    console.error(`[search] error: ${err.message}${cause ? ` | cause: ${cause}` : ""}`);
    res.status(500).json({ error: err.message, cause });
  }
});

// ─── Client config (non-secret values the frontend needs) ────────────────────

app.get("/api/config", (_req, res) => {
  res.json({
    preprodSerial: process.env.PREPROD_DEVICE_SERIAL || "",
    prodSerial:    process.env.PROD_DEVICE_SERIAL    || ""
  });
});

// ─── Noon — fetch invoices & credit notes ─────────────────────────────────────

app.get("/proxy/noon/invoices", async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: "from and to query params required (YYYY-MM-DD)" });
  }

  try {
    const creds = noon.loadCreds();
    const { body, contentType } = await noon.fetchInvoices(creds, from, to);
    res.setHeader("Content-Type", contentType || "text/plain");
    res.send(body);
  } catch (err) {
    const cause = err.cause ? String(err.cause) : "";
    console.error(`[noon] error: ${err.message}${cause ? ` | cause: ${cause}` : ""}`);
    res.status(500).json({ error: err.message, cause });
  }
});

// ─── Fallthrough → SPA ───────────────────────────────────────────────────────

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(port, () => console.log(`http://localhost:${port}`));

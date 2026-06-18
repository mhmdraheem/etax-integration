const path = require("node:path");
const fs   = require("node:fs");
const express = require("express");
const { log } = require("node:console");

// Load .env manually — no extra dependency
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
    clientId:     process.env.PREPROD_CLIENT_ID     || "PREPROD_CLIENT_ID_REMOVED",
    clientSecret: process.env.PREPROD_CLIENT_SECRET || "PREPROD_CLIENT_SECRET_REMOVED",
    posSerial:    process.env.PREPROD_DEVICE_SERIAL || "PREPROD_SERIAL_REMOVED",
    posOsVersion: "android"
  },
  prod: {
    idUrl:        process.env.PROD_ID_URL  || "https://id.eta.gov.eg",
    apiUrl:       process.env.PROD_API_URL || "https://api.invoicing.eta.gov.eg",
    clientId:     process.env.PROD_CLIENT_ID     || "PROD_CLIENT_ID_REMOVED",
    clientSecret: process.env.PROD_CLIENT_SECRET || "PROD_CLIENT_SECRET_REMOVED",
    posSerial:    process.env.PROD_DEVICE_SERIAL || "PROD_SERIAL_REMOVED",
    posOsVersion: "windows"
  }
};

const app  = express();
const port = Number(process.env.PORT || 3000);

app.use(express.static(__dirname));

// Authenticate with ETA, fetch last submitted receipt UUID, return it.
app.get("/proxy/receipts/recent", async (req, res) => {
  const env = req.query.env === "prod" ? "prod" : "preprod";
  const cfg = envConfigs[env];

  console.log(`[proxy] env=${env} idUrl=${cfg.idUrl} apiUrl=${cfg.apiUrl} hasClientId=${!!cfg.clientId} hasClientSecret=${!!cfg.clientSecret}`);

  if (!cfg.clientId || !cfg.clientSecret) {
    console.error(`[proxy] Missing credentials for "${env}"`);
    return res.status(400).json({ error: `No credentials configured for "${env}" in .env` });
  }

  try {
    // 1 — Authenticate
    const tokenUrl = `${cfg.idUrl}/connect/token`;
    console.log(`[auth] POST ${tokenUrl}`);
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        posserial:      cfg.posSerial,
        pososversion:   cfg.posOsVersion
       },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     cfg.clientId,
        client_secret: cfg.clientSecret
      }).toString()
    });
    const tokenText = await tokenRes.text();
    console.log(`[auth] status=${tokenRes.status} body=${tokenText}`);
    if (!tokenRes.ok) throw new Error(`Auth failed (${tokenRes.status}): ${tokenText}`);
    const { access_token } = JSON.parse(tokenText);
    if (!access_token) throw new Error("No access_token in auth response");

    // 2 — Fetch last receipt
    const recentUrl = `${cfg.apiUrl}/api/v1/receipts/recent?SortBy=DateTimeReceived&SortDir=Desc&PageNo=1&PageSize=1`;
    console.log(`[receipts] GET ${recentUrl}`);
    const recentRes = await fetch(recentUrl, {
      headers: {
        Authorization:  `Bearer ${access_token}`
      }
    });
    const recentText = await recentRes.text();
    console.log(`[receipts] status=${recentRes.status} body=${recentText}`);
    if (!recentRes.ok) throw new Error(`Receipts API failed (${recentRes.status}): ${recentText}`);
    const data = JSON.parse(recentText);

    const uuid = data.receipts?.[0]?.uuid;
    if (!uuid) throw new Error("No receipts found in ETA");

    console.log(`[proxy] success uuid=${uuid}`);
    res.json({ uuid });
  } catch (err) {
    const cause = err.cause ? String(err.cause) : "";
    console.error(`[proxy] error: ${err.message}${cause ? ` | cause: ${cause}` : ""}`);
    res.status(500).json({ error: err.message, cause });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(port, () => console.log(`http://localhost:${port}`));

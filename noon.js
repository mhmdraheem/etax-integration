const crypto = require("node:crypto");
const fs     = require("node:fs");

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function base64url(input) {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signRS256(payload, privateKeyPem) {
  const header  = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims  = base64url(JSON.stringify(payload));
  const signing = `${header}.${claims}`;
  const sig     = crypto.sign("SHA256", Buffer.from(signing), privateKeyPem);
  return `${signing}.${base64url(sig)}`;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function authenticate(creds) {
  const token = signRS256(
    { sub: creds.key_id, iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID() },
    creds.private_key
  );

  const url = "https://noon-api-gateway.noon.partners/identity/public/v1/api/login";
  console.log(`[noon-auth] POST ${url}`);

  const res  = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "NoonApiClient/1.0" },
    body: JSON.stringify({ token, default_project_code: creds.project_code })
  });

  const text = await res.text();
  console.log(`[noon-auth] status=${res.status} body_preview=${text.substring(0, 200)}`);
  if (!res.ok) throw new Error(`Noon auth failed (${res.status}): ${text.substring(0, 300)}`);

  const rawCookies = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);

  const cookieStr = rawCookies.map(c => c.split(";")[0]).join("; ");
  console.log(`[noon-auth] cookies: ${cookieStr.substring(0, 80)}…`);
  return cookieStr;
}

// ─── Invoice fetch ────────────────────────────────────────────────────────────

// Mirrors the exact URL the finance portal uses; only from/to change.
// https://finance.noon.partners/en/invoices-and-creditnotes/?page=1&limits=20&from=...&to=...
//   &contractOrderNrs=%5B%22CONTRACT_NR_REMOVED%22%5D&transactionTypes=customer&store=NOON
//   &project=PRJ452348&reportTab=individual
async function fetchInvoices(creds, from, to) {
  const cookieStr  = await authenticate(creds);
  const contractNr = process.env.NOON_CONTRACT_NR || "";

  const params = new URLSearchParams([
    ["page",             "1"],
    ["limits",           "500"],
    ["from",             from],
    ["to",               to],
    ["contractOrderNrs", JSON.stringify([contractNr])],
    ["transactionTypes", "customer"],
    ["store",            "NOON"],
    ["project",          creds.project_code],
    ["reportTab",        "individual"]
  ]);

  const url = `https://finance.noon.partners/en/invoices-and-creditnotes/?${params}`;
  console.log(`[noon-invoices] GET ${url}`);

  const res  = await fetch(url, {
    headers: {
      Cookie:       cookieStr,
      Accept:       "application/json, text/csv, */*",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NoonApiClient/1.0",
      Referer:      "https://finance.noon.partners/"
    }
  });

  const body = await res.text();
  const ct   = res.headers.get("content-type") || "";
  console.log(`[noon-invoices] status=${res.status} content-type=${ct}`);
  console.log(`[noon-invoices] body_preview=${body.substring(0, 500)}`);

  if (!res.ok) throw new Error(`Noon finance returned ${res.status}: ${body.substring(0, 300)}`);

  return { body, contentType: ct };
}

// ─── Credentials loader ───────────────────────────────────────────────────────

function loadCreds() {
  const credsPath = process.env.NOON_CREDENTIALS_PATH;
  if (!credsPath) throw new Error("NOON_CREDENTIALS_PATH not set in .env");
  if (!fs.existsSync(credsPath)) throw new Error(`Credentials file not found: ${credsPath}`);
  try {
    return JSON.parse(fs.readFileSync(credsPath, "utf8"));
  } catch (e) {
    throw new Error(`Could not read credentials file: ${e.message}`);
  }
}

module.exports = { fetchInvoices, loadCreds };

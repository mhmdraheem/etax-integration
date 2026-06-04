# Noon Receipt Builder

## Run Locally

Install dependencies once:

```powershell
npm install
```

Create a local `.env` file if your MySQL credentials differ from the defaults:

```powershell
Copy-Item .env.example .env
```

Start the app:

```powershell
npm start
```

Open `http://localhost:3000`.

The backend serves the frontend from `public/` and saves successful batches to your locally installed MySQL instance.

## MySQL

Default connection:

- host: `127.0.0.1`
- port: `3306`
- database: `receipts_system`
- user: `root`
- password: empty

On startup, the backend tries to create the configured database when the MySQL user has permission, then creates/updates the required tables. You can also run [database/schema.sql](database/schema.sql) manually.

## SDK Configuration

Set these values in `.env` before using **Send to SDK**:

- `SDK_AUTH_URL`
- `SDK_SUBMIT_RECEIPTS_URL`
- `SDK_SUBMIT_RETURN_RECEIPTS_URL`
- `SDK_GET_SUBMISSION_URL`
- `SDK_CLIENT_ID`
- `SDK_CLIENT_SECRET`
- `SDK_USERNAME`
- `SDK_PASSWORD`
- `SDK_AUTH_TOKEN_PATH`
- `SDK_POLL_INTERVAL_MS`
- `SDK_POLL_MAX_ATTEMPTS`

`SDK_GET_SUBMISSION_URL` can include `{submissionID}` or `{submissionId}` as a placeholder.

If your SDK authentication body needs a custom JSON payload, set `SDK_AUTH_BODY` to a JSON string. Otherwise the backend sends `clientId`, `clientSecret`, `username`, and `password`.

## Pages

- `http://localhost:3000/index.html` - Noon CSV Receipt Builder
- `http://localhost:3000/uuid-generator.html` - ETA UUID Generator

The two pages are linked in the top navigation.

## Project Structure

- `public/index.html` - receipt builder markup
- `public/uuid-generator.html` - copied UUID generator page
- `public/styles.css` - receipt builder styles
- `public/app.js` - CSV parsing, receipt generation, ZIP download, API calls
- `server/index.js` - Node/Express backend and MySQL persistence API
- `database/schema.sql` - optional manual MySQL schema setup

## API

- `GET /api/history` returns the last UUID and order UUID lookup map.
- `POST /api/batches` saves a processed batch and its receipt rows.
- `DELETE /api/history` clears saved batches and receipts.

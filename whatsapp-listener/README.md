# WatchFacts WhatsApp Listener

Real-time WhatsApp message capture using Baileys (no browser needed).

## Setup

```bash
cd ~/wf/whatsapp-listener
npm install
```

## Run

```bash
export INGEST_API_TOKEN=<same secret configured in Vercel>
node index.js
```

On Windows PowerShell:

```powershell
$env:INGEST_API_TOKEN='<same secret configured in Vercel>'
node index.js
```

The listener sends this value as a bearer token to `/api/ingest`. Keep it in
Railway or the local environment only; do not commit it.

## First Time: Pair with WhatsApp

1. Run `node index.js`
2. A **QR code** appears in terminal
3. Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
4. Scan the QR code
5. Bot connects and starts listening

## What It Does

- Automatically captures ALL messages from any group containing "WatchFacts"
- Splits multi-watch messages (e.g., 3 watches in one text)
- Parses: reference, brand, dial color, price, currency, condition, year
- Downloads images attached to messages
- Sends parsed data to: `https://watchfacts-poc.vercel.app/api/ingest`

## Output

- Parsed records appear in the web app automatically
- Images saved to `./downloaded_images/`
- Auth session saved to `./auth_baileys/` (don't delete — keeps you logged in)

## Multi-Watch Example

Input message:
```
🎉Used 7118/1A-011 grey naked 466k hkd
🎉Used 7118/1A-011 green 490k hkd
🎉BNIB 7118/1R 2025 520k hkd
```

Output: 3 separate records with individual references, prices, conditions.

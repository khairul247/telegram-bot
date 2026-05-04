# 🤖 Telegram Order Bot

A Telegram bot with a web dashboard for verifying customer payments.

---

## What It Does

- Customer starts the bot → sees 2 buttons
- **Ask Directly** → sends your Telegram username link
- **Buy Now** → sends QR code, waits for receipt photo
- Receipt appears on your dashboard → you approve or reject
- Bot notifies the customer instantly

---

## Setup (5 steps)

### Step 1 — Get a Bot Token
1. Open Telegram, search for `@BotFather`
2. Send `/newbot` and follow the steps
3. Copy the token it gives you

### Step 2 — Configure the bot
```bash
cd telegram-bot
cp .env.example .env
```
Edit `.env` and fill in:
- `BOT_TOKEN` — your token from BotFather
- `ADMIN_USERNAME` — your Telegram username (without @)

### Step 3 — Add your QR code
Place your payment QR code image as:
```
telegram-bot/qr.png
```

### Step 4 — Start the bot backend
```bash
cd telegram-bot
npm install
npm start
```
The API server runs at: http://localhost:3001

### Step 5 — Start the dashboard
Open a second terminal:
```bash
cd telegram-bot/dashboard
npm install
npm run dev
```
Dashboard runs at: http://localhost:5173

---

## How to Verify Orders

1. Open http://localhost:5173 in your browser
2. When a customer sends a receipt, it appears automatically (refreshes every 4 seconds)
3. Click any order to open it
4. View the receipt image
5. Click **Approve ✅** or **Reject ❌**
6. The customer gets notified on Telegram instantly

---

## Project Structure

```
telegram-bot/
├── index.js          # Bot logic + Express API
├── package.json
├── .env              # Your config (BOT_TOKEN etc.)
├── qr.png            # Your payment QR code
├── uploads/          # Customer receipt photos (auto-created)
└── dashboard/        # React web dashboard
    ├── src/
    │   ├── App.jsx   # Main dashboard UI
    │   └── index.css
    ├── vite.config.js
    └── package.json
```

---

## Notes

- Orders are stored in memory — they reset when the bot restarts
- For persistent storage, a future upgrade would add SQLite
- To deploy to Railway later, just push to GitHub and connect the repo

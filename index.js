const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const Database = require("better-sqlite3");
require('dotenv').config()

// ─── CONFIG ────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const ADMIN_TELEGRAM_USERNAME = process.env.ADMIN_USERNAME || "yourusername"; // without @
const PORT = process.env.PORT || 3001;
const UPLOADS_DIR = path.join(__dirname, "uploads");
const DB_DIR = path.join(__dirname, "db");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// ─── DATABASE ──────────────────────────────────────────────────────────────
const db = new Database(path.join(DB_DIR, "orders.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customerId INTEGER NOT NULL,
    customerName TEXT,
    customerUsername TEXT,
    receiptFile TEXT,
    status TEXT DEFAULT 'pending',
    timestamp TEXT,
    verifiedAt TEXT
  )
`);

const insertOrder = db.prepare(`
  INSERT INTO orders (id, customerId, customerName, customerUsername, receiptFile, status, timestamp)
  VALUES (@id, @customerId, @customerName, @customerUsername, @receiptFile, @status, @timestamp)
`);
const getOrder = db.prepare("SELECT * FROM orders WHERE id = ?");
const getAllOrders = db.prepare("SELECT * FROM orders ORDER BY timestamp DESC");
const updateOrderStatus = db.prepare("UPDATE orders SET status = ?, verifiedAt = ? WHERE id = ?");

// Restore counter from DB
const lastOrder = db.prepare("SELECT id FROM orders ORDER BY rowid DESC LIMIT 1").get();
let orderCounter = lastOrder ? parseInt(lastOrder.id.split("-")[1]) + 1 : 1;

// customerState: { [chatId]: 'idle' | 'awaiting_receipt' }
const customerState = {};

// ─── BOT ───────────────────────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "💬 Ask Me Directly", callback_data: "ask_directly" }],
      [{ text: "🛒 Buy Now", callback_data: "buy_now" }],
    ],
  },
};

bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || "there";
  customerState[msg.chat.id] = "idle";
  bot.sendMessage(
    msg.chat.id,
    `👋 Hey ${name}! Welcome!\n\nHow can I help you today?`,
    mainMenu
  );
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  await bot.answerCallbackQuery(query.id);

  if (data === "ask_directly") {
    bot.sendMessage(
      chatId,
      `📱 Sure! You can reach me directly on Telegram:\n\n👉 @${ADMIN_TELEGRAM_USERNAME}\n\nFeel free to message me anytime!`
    );
    customerState[chatId] = "idle";
  }

  if (data === "buy_now") {
    customerState[chatId] = "awaiting_receipt";

    // Send QR code
    const qrPath = path.join(__dirname, "qr.png");
    if (fs.existsSync(qrPath)) {
      await bot.sendPhoto(chatId, qrPath, {
        caption:
          "💳 Please scan the QR code to make your payment.\n\nOnce done, send me your receipt photo here and I'll verify it shortly! ✅",
      });
    } else {
      await bot.sendMessage(
        chatId,
        "💳 Please make your payment using our payment details.\n\nOnce done, send me your receipt photo here and I'll verify it shortly! ✅\n\n_(QR code image not found — please add qr.png to the bot folder)_",
        { parse_mode: "Markdown" }
      );
    }
  }
});

// Handle receipt photo
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;

  if (customerState[chatId] !== "awaiting_receipt") {
    bot.sendMessage(chatId, "Please use /start to begin.", mainMenu);
    return;
  }

  // Download the highest-res photo
  const photoId = msg.photo[msg.photo.length - 1].file_id;
  const orderId = `ORD-${String(orderCounter++).padStart(3, "0")}`;
  const fileName = `${orderId}-${Date.now()}.jpg`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  try {
    const fileInfo = await bot.getFile(photoId);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    const https = require("https");
    const file = fs.createWriteStream(filePath);
    await new Promise((resolve, reject) => {
      https.get(fileUrl, (res) => {
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
      }).on("error", reject);
    });

    // Save order
    insertOrder.run({
      id: orderId,
      customerId: chatId,
      customerName: `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim(),
      customerUsername: msg.from.username || null,
      receiptFile: fileName,
      status: "pending",
      timestamp: new Date().toISOString(),
    });

    customerState[chatId] = "idle";

    bot.sendMessage(
      chatId,
      `✅ Receipt received! Your order ID is *${orderId}*.\n\nWe'll verify your payment and get back to you shortly. Thank you! 🙏`,
      { parse_mode: "Markdown" }
    );

    console.log(`[NEW ORDER] ${orderId} from ${getOrder.get(orderId).customerName}`);
  } catch (err) {
    console.error("Error saving receipt:", err);
    bot.sendMessage(chatId, "❌ Something went wrong. Please try again.");
  }
});

// ─── EXPRESS API ────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));

// GET all orders
app.get("/api/orders", (req, res) => {
  res.json(getAllOrders.all());
});

// POST verify order (approve/reject)
app.post("/api/orders/:id/verify", (req, res) => {
  const { id } = req.params;
  const { action, message } = req.body; // action: 'approve' | 'reject'

  const order = getOrder.get(id);
  if (!order) return res.status(404).json({ error: "Order not found" });

  const status = action === "approve" ? "approved" : "rejected";
  const verifiedAt = new Date().toISOString();
  updateOrderStatus.run(status, verifiedAt, id);

  const customerId = order.customerId;

  if (action === "approve") {
    bot.sendMessage(
      customerId,
      `🎉 Great news! Your payment for *${id}* has been *verified* and approved!\n\n${message || "Thank you for your purchase! We'll be in touch shortly. 😊"}`,
      { parse_mode: "Markdown" }
    );
  } else {
    bot.sendMessage(
      customerId,
      `❌ Unfortunately, your payment for *${id}* could not be verified.\n\n${message || "Please contact us directly for assistance."}`,
      { parse_mode: "Markdown" }
    );
  }

  res.json({ success: true, order: getOrder.get(id) });
});

// GET stats
app.get("/api/stats", (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(status = 'pending') as pending,
      SUM(status = 'approved') as approved,
      SUM(status = 'rejected') as rejected
    FROM orders
  `).get();
  res.json(stats);
});

// Serve built dashboard
app.use(express.static(path.join(__dirname, "dashboard/dist")));
app.get("*", (_req, res) => {
  const indexPath = path.join(__dirname, "dashboard/dist/index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(503).send("Dashboard not built. Run: npm run build");
  }
});

app.listen(PORT, () => {
  console.log(`\n🤖 Telegram Bot is running...`);
  console.log(`🌐 API server running at http://localhost:${PORT}`);
  console.log(`📋 Dashboard: open the dashboard folder separately\n`);
});

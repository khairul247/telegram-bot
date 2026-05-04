const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const path = require("path");
const fs = require("fs");
const https = require("https");
const cors = require("cors");
const Database = require("better-sqlite3");
require('dotenv').config()

// ─── CONFIG ────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const ADMIN_TELEGRAM_USERNAME = process.env.ADMIN_USERNAME || "yourusername";
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
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

const insertOrder = db.prepare(`
  INSERT INTO orders (id, customerId, customerName, customerUsername, receiptFile, status, timestamp)
  VALUES (@id, @customerId, @customerName, @customerUsername, @receiptFile, @status, @timestamp)
`);
const getOrder = db.prepare("SELECT * FROM orders WHERE id = ?");
const getAllOrders = db.prepare("SELECT * FROM orders ORDER BY timestamp DESC");
const updateOrderStatus = db.prepare("UPDATE orders SET status = ?, verifiedAt = ? WHERE id = ?");
const getSetting = db.prepare("SELECT value FROM settings WHERE key = ?");
const setSetting = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");

// Restore counter and admin chat ID from DB
const lastOrder = db.prepare("SELECT id FROM orders ORDER BY rowid DESC LIMIT 1").get();
let orderCounter = lastOrder ? parseInt(lastOrder.id.split("-")[1]) + 1 : 1;

const savedAdminChatId = getSetting.get("adminChatId");
let adminChatId = savedAdminChatId ? parseInt(savedAdminChatId.value) : null;

// customerState: { [chatId]: 'idle' | 'awaiting_receipt' | 'awaiting_order_id' }
const customerState = {};

// ─── BOT ───────────────────────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "💬 Ask Me Directly", callback_data: "ask_directly" }],
      [{ text: "🛒 Buy Now", callback_data: "buy_now" }],
      [{ text: "📦 Check Order Status", callback_data: "check_status" }],
    ],
  },
};

const statusEmoji = { pending: "⏳", approved: "✅", rejected: "❌" };

bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || "there";
  const username = msg.from.username;

  // Auto-detect and persist admin chat ID
  if (username && username.toLowerCase() === ADMIN_TELEGRAM_USERNAME.toLowerCase() && msg.chat.id !== adminChatId) {
    adminChatId = msg.chat.id;
    setSetting.run("adminChatId", String(adminChatId));
    console.log(`[ADMIN] Registered admin chat ID: ${adminChatId}`);
  }

  customerState[msg.chat.id] = "idle";
  bot.sendMessage(msg.chat.id, `👋 Hey ${name}! Welcome!\n\nHow can I help you today?`, mainMenu);
});

bot.onText(/\/cancel/, (msg) => {
  customerState[msg.chat.id] = "idle";
  bot.sendMessage(msg.chat.id, "❌ Cancelled. How can I help you?", mainMenu);
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  await bot.answerCallbackQuery(query.id);

  if (data === "ask_directly") {
    customerState[chatId] = "idle";
    bot.sendMessage(
      chatId,
      `📱 Sure! You can reach me directly on Telegram:\n\n👉 @${ADMIN_TELEGRAM_USERNAME}\n\nFeel free to message me anytime!`
    );
  }

  if (data === "buy_now") {
    customerState[chatId] = "awaiting_receipt";
    const qrPath = path.join(__dirname, "qr.png");
    if (fs.existsSync(qrPath)) {
      await bot.sendPhoto(chatId, qrPath, {
        caption: "💳 Please scan the QR code to make your payment.\n\nOnce done, send me your receipt photo here and I'll verify it shortly! ✅\n\nType /cancel to go back.",
      });
    } else {
      await bot.sendMessage(
        chatId,
        "💳 Please make your payment using our payment details.\n\nOnce done, send me your receipt photo here and I'll verify it shortly! ✅\n\nType /cancel to go back."
      );
    }
  }

  if (data === "check_status") {
    customerState[chatId] = "awaiting_order_id";
    bot.sendMessage(chatId, "📦 Please enter your order ID (e.g. ORD-001):\n\nType /cancel to go back.");
  }
});

// Shared receipt handler for both photo and document
async function handleReceipt(msg, fileId) {
  const chatId = msg.chat.id;
  const orderId = `ORD-${String(orderCounter++).padStart(3, "0")}`;
  const fileName = `${orderId}-${Date.now()}.jpg`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  try {
    const fileInfo = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    const file = fs.createWriteStream(filePath);
    await new Promise((resolve, reject) => {
      https.get(fileUrl, (res) => {
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
      }).on("error", reject);
    });

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

    if (adminChatId) {
      const order = getOrder.get(orderId);
      const name = order.customerName || "Unknown";
      const handle = order.customerUsername ? `@${order.customerUsername}` : "no username";
      bot.sendMessage(
        adminChatId,
        `🔔 *New Order!*\n\nOrder ID: *${orderId}*\nCustomer: ${name} (${handle})\n\nCheck the dashboard to verify.`,
        { parse_mode: "Markdown" }
      );
    }

    console.log(`[NEW ORDER] ${orderId} from ${getOrder.get(orderId).customerName}`);
  } catch (err) {
    console.error("Error saving receipt:", err);
    bot.sendMessage(chatId, "❌ Something went wrong. Please try again.");
  }
}

// Handle receipt photo
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  if (customerState[chatId] !== "awaiting_receipt") {
    bot.sendMessage(chatId, "Please use /start to begin.", mainMenu);
    return;
  }
  await handleReceipt(msg, msg.photo[msg.photo.length - 1].file_id);
});

// Handle photo sent as file/document
bot.on("document", async (msg) => {
  const chatId = msg.chat.id;
  if (customerState[chatId] !== "awaiting_receipt") {
    bot.sendMessage(chatId, "Please use /start to begin.", mainMenu);
    return;
  }
  if (!msg.document.mime_type || !msg.document.mime_type.startsWith("image/")) {
    bot.sendMessage(chatId, "❌ Please send an image file of your receipt.");
    return;
  }
  await handleReceipt(msg, msg.document.file_id);
});

// Handle text messages
bot.on("message", (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  const chatId = msg.chat.id;
  const state = customerState[chatId] || "idle";

  if (state === "awaiting_receipt") {
    bot.sendMessage(chatId, "📸 Please send a *photo* of your payment receipt.\n\nType /cancel to go back.", { parse_mode: "Markdown" });
    return;
  }

  if (state === "awaiting_order_id") {
    const orderId = msg.text.trim().toUpperCase();
    const order = getOrder.get(orderId);
    customerState[chatId] = "idle";

    if (!order) {
      bot.sendMessage(chatId, `❌ Order *${orderId}* not found. Please check your order ID.`, { parse_mode: "Markdown" });
      return;
    }

    const emoji = statusEmoji[order.status] || "❓";
    bot.sendMessage(
      chatId,
      `📦 Order *${order.id}*\nStatus: ${emoji} *${order.status.toUpperCase()}*\nSubmitted: ${new Date(order.timestamp).toLocaleString()}`,
      { parse_mode: "Markdown", reply_markup: mainMenu.reply_markup }
    );
    return;
  }

  bot.sendMessage(chatId, "👋 Use the menu below to get started!", mainMenu);
});

// ─── EXPRESS API ────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/api/orders", (req, res) => {
  res.json(getAllOrders.all());
});

app.post("/api/orders/:id/verify", (req, res) => {
  const { id } = req.params;
  const { action, message } = req.body;

  const order = getOrder.get(id);
  if (!order) return res.status(404).json({ error: "Order not found" });

  const status = action === "approve" ? "approved" : "rejected";
  updateOrderStatus.run(status, new Date().toISOString(), id);

  if (action === "approve") {
    bot.sendMessage(
      order.customerId,
      `🎉 Great news! Your payment for *${id}* has been *verified* and approved!\n\n${message || "Thank you for your purchase! We'll be in touch shortly. 😊"}`,
      { parse_mode: "Markdown" }
    );
  } else {
    bot.sendMessage(
      order.customerId,
      `❌ Unfortunately, your payment for *${id}* could not be verified.\n\n${message || "Please contact us directly for assistance."}`,
      { parse_mode: "Markdown" }
    );
  }

  res.json({ success: true, order: getOrder.get(id) });
});

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

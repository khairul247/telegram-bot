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
const GROUP_ID = process.env.GROUP_ID || null;
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
      [{ text: "💬 Nak PM tepi?", callback_data: "ask_directly" }],
      [{ text: "🛒 Nak bayar terus?", callback_data: "buy_now" }],
      [{ text: "📦 Nak check status order?", callback_data: "check_status" }],
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
  bot.sendMessage(msg.chat.id, `👋 Hi ${name}!\n\nApa yang saya boleh tolong ya?`, mainMenu);
});

bot.onText(/\/cancel/, (msg) => {
  customerState[msg.chat.id] = "idle";
  bot.sendMessage(msg.chat.id, "❌ Cancelled. Apa saya boleh tolong ya?", mainMenu);
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  await bot.answerCallbackQuery(query.id);

  if (data === "ask_directly") {
    customerState[chatId] = "idle";
    bot.sendMessage(
      chatId,
      `📱 Boleh contact saya terus di\n\n👉 @${ADMIN_TELEGRAM_USERNAME}`
    );
  }

  if (data === "buy_now") {
    customerState[chatId] = "awaiting_receipt";
    const qrPath = path.join(__dirname, "qr.png");
    if (fs.existsSync(qrPath)) {
      await bot.sendPhoto(chatId, qrPath, {
        caption: "💳 Boleh buat pembayaran guna QR code ni ya.\n\nBila dah hantar, nanti saya akan verify ✅\n\nTaip /cancel kalau nak batalkan pembayaran",
      });
    } else {
      await bot.sendMessage(
        chatId,
        "💳 Boleh buat pembayaran di QR code ni ya.\n\nBila dah hantar, nanti saya akan verify ✅\n\nTaip /cancel kalau nak batalkan pembayaran."
      );
    }
  }

  if (data === "check_status") {
    customerState[chatId] = "awaiting_order_id";
    bot.sendMessage(chatId, "📦 Masukkan ord no (e.g. ORD-001):\n\nTaip /cancel untuk patah balik.");
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
      `✅ Ok dah dapat resit! Ini ID awak ya: *${orderId}*.\n\nLepas saya verify, nanti saya akan bagi link untuk join group ya 🙏`,
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
    bot.sendMessage(chatId, "Sila guna /start untuk mula balik.", mainMenu);
    return;
  }
  await handleReceipt(msg, msg.photo[msg.photo.length - 1].file_id);
});

// Handle photo sent as file/document
bot.on("document", async (msg) => {
  const chatId = msg.chat.id;
  if (customerState[chatId] !== "awaiting_receipt") return;
  if (!msg.document.mime_type || !msg.document.mime_type.startsWith("image/")) {
    bot.sendMessage(chatId, "❌ Tolong hantar bukti pembayaran dalam bentuk *gambar* ya.\n\nTaip /cancel kalau nak batalkan.", { parse_mode: "Markdown" });
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
    bot.sendMessage(chatId, "📸 Sila hantar *bukti* pembayaran awak ya.\n\nTaip /cancel untuk kembali ke halaman utama.", { parse_mode: "Markdown" });
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

  bot.sendMessage(chatId, "Hi, apa yang saya boleh tolong?", mainMenu);
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
    console.log(`[APPROVE] ${id} | GROUP_ID=${GROUP_ID} | customerId=${order.customerId}`);
    if (GROUP_ID) {
      bot.createChatInviteLink(GROUP_ID, { member_limit: 1 }).then(invite => {
        console.log(`[INVITE LINK] ${invite.invite_link}`);
        bot.sendMessage(
          order.customerId,
          `🎉 Saya dah sahkan pembayaran awak ya untuk <b>${id}</b>. \n\n${message || "Terima kasih. 😊"}\n\n👥 Jemput join group (one-time link): ${invite.invite_link}`,
          { parse_mode: "HTML" }
        );
      }).catch(err => {
        console.error(`[INVITE LINK ERROR] ${err.message}`);
        bot.sendMessage(
          order.customerId,
          `🎉 Saya dah sahkan pembayaran awak ya untuk <b>${id}</b>. \n\n${message || "Terima kasih. 😊"}`,
          { parse_mode: "HTML" }
        );
      });
    } else {
      bot.sendMessage(
        order.customerId,
        `🎉 Saya dah sahkan pembayaran awak ya untuk <b>${id}</b>. \n\n${message || "Terima kasih. 😊"}`,
        { parse_mode: "HTML" }
      );
    }
  } else {
    bot.sendMessage(
      order.customerId,
      `Maaf, saya tak dapat sahkan pembayaran awak untuk <b>${id}</b>.\n\n${message || `Boleh terus pm saya ya @${ADMIN_TELEGRAM_USERNAME}`}`,
      { parse_mode: "HTML" }
    );
  }

  res.json({ success: true, order: getOrder.get(id) });
});

app.delete("/api/orders", (req, res) => {
  const orders = getAllOrders.all();
  for (const order of orders) {
    if (order.receiptFile) {
      const filePath = path.join(UPLOADS_DIR, order.receiptFile);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }
  db.prepare("DELETE FROM orders").run();
  orderCounter = 1;
  console.log("[FACTORY RESET] All orders and receipt images deleted");
  res.json({ success: true });
});

app.delete("/api/orders/:id", (req, res) => {
  const { id } = req.params;
  const order = getOrder.get(id);
  if (!order) return res.status(404).json({ error: "Order not found" });

  if (order.receiptFile) {
    const filePath = path.join(UPLOADS_DIR, order.receiptFile);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.prepare("DELETE FROM orders WHERE id = ?").run(id);
  res.json({ success: true });
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

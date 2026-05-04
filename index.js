const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
require('dotenv').config()

// ─── CONFIG ────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const ADMIN_TELEGRAM_USERNAME = process.env.ADMIN_USERNAME || "yourusername"; // without @
const PORT = process.env.PORT || 3001;
const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── STATE ─────────────────────────────────────────────────────────────────
// orders: { [orderId]: { id, customerId, customerName, customerUsername, receiptPath, status, timestamp } }
const orders = {};
let orderCounter = 1;

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
    orders[orderId] = {
      id: orderId,
      customerId: chatId,
      customerName: `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim(),
      customerUsername: msg.from.username || null,
      receiptFile: fileName,
      status: "pending",
      timestamp: new Date().toISOString(),
    };

    customerState[chatId] = "idle";

    bot.sendMessage(
      chatId,
      `✅ Receipt received! Your order ID is *${orderId}*.\n\nWe'll verify your payment and get back to you shortly. Thank you! 🙏`,
      { parse_mode: "Markdown" }
    );

    console.log(`[NEW ORDER] ${orderId} from ${orders[orderId].customerName}`);
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
  res.json(Object.values(orders).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
});

// POST verify order (approve/reject)
app.post("/api/orders/:id/verify", (req, res) => {
  const { id } = req.params;
  const { action, message } = req.body; // action: 'approve' | 'reject'

  if (!orders[id]) return res.status(404).json({ error: "Order not found" });

  orders[id].status = action === "approve" ? "approved" : "rejected";
  orders[id].verifiedAt = new Date().toISOString();

  const customerId = orders[id].customerId;

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

  res.json({ success: true, order: orders[id] });
});

// GET stats
app.get("/api/stats", (req, res) => {
  const all = Object.values(orders);
  res.json({
    total: all.length,
    pending: all.filter((o) => o.status === "pending").length,
    approved: all.filter((o) => o.status === "approved").length,
    rejected: all.filter((o) => o.status === "rejected").length,
  });
});

// Serve built dashboard
app.use(express.static(path.join(__dirname, "dashboard/dist")));
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "dashboard/dist/index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🤖 Telegram Bot is running...`);
  console.log(`🌐 API server running at http://localhost:${PORT}`);
  console.log(`📋 Dashboard: open the dashboard folder separately\n`);
});

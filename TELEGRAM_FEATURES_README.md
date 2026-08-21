# MoniMonitor Telegram Bot Integration

This document outlines the architecture and features of the advanced Telegram Bot integration within the MoniMonitor system. The integration allows for real-time, interactive, and secure financial transaction tracking directly from the Telegram app.

---

## 🏗️ Architecture & File Structure

The Telegram features are deeply integrated into the backend Node.js server. Here are the key files driving this functionality:

### 1. `server/src/services/telegramService.js`
This is the core engine for communicating with the Telegram Bot API. It implements several custom functions without relying on heavy third-party libraries:
- **`sendTelegramMessage`**: Sends rich `MarkdownV2` messages. Supports advanced flags like `protect_content` (to prevent forwarding of sensitive data) and `disable_notification` (for silent alerts).
- **`editTelegramMessage`**: Allows the bot to dynamically update the text or buttons of an existing message (used heavily for UI interactions).
- **`deleteTelegramMessage`**: Removes old or generic messages when a more specific transaction is detected.
- **`setTelegramReaction`**: Adds an emoji reaction (e.g., 👀) to a user's message to provide instant feedback.
- **`formatTransactionMessage`**: A custom formatter that parses database rows into beautiful MarkdownV2 cards. Uses **expandable blockquotes** (`**>`) for clean formatting of transaction reasons.
- **`startTelegramPolling`**: A robust long-polling loop (`getUpdates`) that continuously listens for incoming messages and button clicks from the user.

### 2. `server/email_agent.js`
This file acts as the orchestrator. It listens for incoming bank emails, parses them with Gemini AI, and then triggers the Telegram notification workflow. 
- **Notification Logic (`notifyAndSave`)**: Evaluates incoming transactions. If a transaction is generic or under $5, it is sent silently. It attaches inline interactive buttons (`🏷️ Recategorize`, `🔄 Internal Transfer`) to the alert.
- **Update Listener (`onTelegramUpdate`)**: 
  - **Callback Queries**: Handles button clicks:
    - `🏷️ Recategorize` (`recat:<id>`): Displays category buttons and applies selection (`setcat:<id>`).
    - `🔄 Internal Transfer` (`transfer:<id>`): Reclassifies the transaction to Category `Internal` and Label `Internal Transfer` with a route to/from a `Temporary` account (`Internal transfer: <Source> -> Temporary` or `Temporary -> <Dest>`), and automatically triggers internal counterpart matching when counterpart legs (including money transferred back to the account) exist or arrive.
  - **Commands**: Listens for text commands like `/summary` and `/recent` and responds with a link to the WebApp Dashboard.
  - **AI Learning**: Whenever a category is manually changed via Telegram buttons, this file instructs the database to save a "Merchant Rule", teaching the system your preferences for future transactions.

### 3. `server/src/database/db.js` & `server/src/database/dbService.js`
- The `transactions` table includes a `TelegramMessageId` column. 
- **Why?** Storing the message ID allows the backend to keep a permanent link between a database row and the specific Telegram message bubble. If an email is re-processed or updated, the backend knows exactly which Telegram message to delete or edit.

### 4. `server/get_chat_id.js`
A utility script used during initial setup to retrieve the user's `TELEGRAM_CHAT_ID` by polling the bot's unread messages.

### 5. `server/.env`
Stores the required credentials securely:
- `TELEGRAM_BOT_TOKEN`: The API key provided by BotFather.
- `TELEGRAM_CHAT_ID`: The unique ID of the private chat where alerts are sent.

---

## ✨ Key Capabilities

1. **Interactive Keyboards (A2UI)**
   Instead of just reading alerts, you can act on them. The inline keyboards allow you to instantly categorize transactions or mark them as internal transfers (routed through temporary account). The bot updates the message in place (no spamming the chat with new messages) and records the change in your SQLite database.

2. **Smart Merchant Learning**
   When you correct a transaction's category using the Telegram buttons, the backend saves a rule. Future emails from the same merchant will bypass the AI's default guess and automatically apply your chosen category.

3. **Financial Privacy & Spam Reduction**
   - **Protected Content**: All alerts use `protect_content: true`. Telegram will strictly block attempts to copy or forward the alert, securing your bank details.
   - **Silent Notifications**: Minor transactions (< $5) or generic placeholders are delivered silently using `disable_notification: true` so they don't buzz your phone.

4. **Web App (Mini App) Integration**
   The bot provides smart fallback buttons to launch your React Dashboard. The `email_agent.js` detects whether you are running locally (`http://localhost`) or in production (`https://`) and formats the Telegram button as an integrated WebApp or a standard external browser link accordingly.

// MoniMonitor Cash-Flow Balance widget for Scriptable.
// Add this script to a Medium Scriptable widget.

const API = "https://monimonitor.saeedarabha.com/api";

const TOKEN_KEY = "MoniMonitor.widget.token";
const USERNAME_KEY = "MoniMonitor.widget.username";
const PASSWORD_KEY = "MoniMonitor.widget.password";

// Medium iPhone widget canvas in points.
// The renderer uses the whole canvas and leaves no outer background.
const WIDTH = 338;
const HEIGHT = 158;

const BG = Color.clear();
const CARD = new Color("#211f24");
const TEXT = new Color("#fff5f0");
const MUTED = new Color("#fff5f0", 0.60);
const FAINT = new Color("#fff5f0", 0.35);
const PEACH = new Color("#d49d81");
const GREEN = new Color("#83ffc9");
const RED = new Color("#ff6666");
const CACHE_FILE_NAME = "monimonitor-cash-flow-widget.json";

function cacheFilePath() {
  const manager = FileManager.local();
  return manager.joinPath(manager.documentsDirectory(), CACHE_FILE_NAME);
}

function readWidgetCache() {
  try {
    const manager = FileManager.local();
    const path = cacheFilePath();
    if (!manager.fileExists(path)) return null;
    return JSON.parse(manager.readString(path));
  } catch {
    return null;
  }
}

function writeWidgetCache(stats) {
  try {
    FileManager.local().writeString(cacheFilePath(), JSON.stringify(stats));
  } catch {}
}

function getKeychainValue(key) {
  try {
    return Keychain.contains(key) ? Keychain.get(key) : "";
  } catch {
    return "";
  }
}

function setKeychainValue(key, value) {
  Keychain.set(key, String(value));
}

function removeKeychainValue(key) {
  try {
    if (Keychain.contains(key)) Keychain.remove(key);
  } catch {}
}

async function showMessage(title, message) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction("OK");
  await alert.present();
}

async function askForLogin(forceBlank = false) {
  const alert = new Alert();
  alert.title = "MoniMonitor Login";
  alert.message = "Enter your MoniMonitor username and password.";
  alert.addTextField(
    "Username",
    forceBlank ? "" : getKeychainValue(USERNAME_KEY)
  );
  alert.addSecureTextField(
    "Password",
    forceBlank ? "" : getKeychainValue(PASSWORD_KEY)
  );
  alert.addAction("Sign In");
  alert.addCancelAction("Cancel");

  const result = await alert.present();
  if (result === -1) throw new Error("Login cancelled.");

  const username = alert.textFieldValue(0).trim();
  const password = alert.textFieldValue(1);

  if (!username || !password) {
    throw new Error("Username and password are required.");
  }

  return { username, password };
}

async function submitLogin(credentials) {
  const request = new Request(`${API}/login`);
  request.method = "POST";
  request.headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Cache-Control": "no-cache"
  };
  request.timeoutInterval = 30;
  request.body = JSON.stringify(credentials);

  let data = null;
  let status = 0;

  try {
    data = await request.loadJSON();
    status = request.response.statusCode;
  } catch {
    status = request.response ? request.response.statusCode : 0;
  }

  if (status === 401 || !data?.accessToken) {
    const error = new Error("Invalid username or password.");
    error.statusCode = 401;
    throw error;
  }

  if (status < 200 || status >= 300) {
    throw new Error(`Login failed with status ${status}.`);
  }

  setKeychainValue(TOKEN_KEY, data.accessToken);
  setKeychainValue(USERNAME_KEY, credentials.username);
  setKeychainValue(PASSWORD_KEY, credentials.password);

  return data.accessToken;
}

async function login(forceBlank = false) {
  // A widget cannot display an interactive password prompt.
  if (config.runsInWidget) {
    const username = getKeychainValue(USERNAME_KEY);
    const password = getKeychainValue(PASSWORD_KEY);

    if (!username || !password) {
      throw new Error("Run this script in Scriptable once to log in.");
    }

    return submitLogin({ username, password });
  }

  let blank = forceBlank;

  while (true) {
    const credentials = await askForLogin(blank);

    try {
      return await submitLogin(credentials);
    } catch (error) {
      if (error.statusCode === 401) {
        removeKeychainValue(TOKEN_KEY);
        await showMessage(
          "Login failed",
          "The password was incorrect. Please enter it again."
        );
        blank = true;
        continue;
      }

      throw error;
    }
  }
}

async function apiRequest(path, token, timeout = 12) {
  const request = new Request(`${API}${path}`);
  request.method = "GET";
  // Assign the complete object at once. Mutating request.headers afterward
  // does not reliably update native request headers in Scriptable.
  request.headers = {
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
    "Cache-Control": "no-cache"
  };
  request.timeoutInterval = timeout;

  let data = null;
  let status = 0;

  try {
    data = await request.loadJSON();
    status = request.response.statusCode;
  } catch {
    status = request.response ? request.response.statusCode : 0;
  }

  if (status === 401) {
    const error = new Error("Session expired.");
    error.statusCode = 401;
    throw error;
  }

  if (status < 200 || status >= 300) {
    throw new Error(
      status
        ? `MoniMonitor returned status ${status}.`
        : "Unable to connect to MoniMonitor."
    );
  }

  return data;
}

async function loadWidgetStats() {
  let token = getKeychainValue(TOKEN_KEY);
  let attempt = 0;

  while (attempt < 3) {
    attempt++;
    if (!token) token = await login(attempt > 1);

    try {
      const stats = await apiRequest("/widget/cash-flow", token, 8);
      if (!stats || !Array.isArray(stats.chartItems)) {
        throw new Error("MoniMonitor returned invalid widget data.");
      }
      writeWidgetCache(stats);
      return stats;
    } catch (error) {
      if (error.statusCode === 401) {
        removeKeychainValue(TOKEN_KEY);
        token = "";

        if (!config.runsInWidget) {
          await showMessage("Session expired", "Please sign in again.");
        }
        continue;
      }

      const cached = readWidgetCache();
      if (cached && Array.isArray(cached.chartItems)) return cached;
      throw error;
    }
  }

  const cached = readWidgetCache();
  if (cached && Array.isArray(cached.chartItems)) return cached;
  throw new Error("Login expired. Open this script once and sign in again.");
}

async function loadData() {
  let token = getKeychainValue(TOKEN_KEY);
  let attempt = 0;

  while (attempt < 3) {
    attempt++;

    if (!token) {
      token = await login(attempt > 1);
    }

    try {
      // Load sequentially so the exact 401 is handled reliably by Scriptable.
      const transactionsResponse = await apiRequest("/transactions", token);
      const portfolioResponse = await apiRequest("/portfolio", token);

      return {
        transactions: Array.isArray(transactionsResponse)
          ? transactionsResponse
          : transactionsResponse?.transactions || [],
        portfolio: portfolioResponse || {}
      };
    } catch (error) {
      if (error.statusCode !== 401) throw error;

      removeKeychainValue(TOKEN_KEY);
      token = "";

      if (!config.runsInWidget) {
        await showMessage(
          "Session expired",
          "Please sign in again to refresh the widget."
        );
      }
    }
  }

  throw new Error(
    config.runsInWidget
      ? "Login expired. Open the script once and sign in again."
      : "MoniMonitor rejected the new login. Please verify your credentials."
  );
}

function amountOf(transaction) {
  const amount = Number(transaction?.Amount);
  if (Number.isFinite(amount)) return Math.abs(amount);

  const minor = Number(transaction?.AmountMinor);
  return Number.isFinite(minor) ? Math.abs(minor) / 100 : 0;
}

function isIncome(transaction) {
  return (
    transaction?.Category === "Income" ||
    transaction?.Type === "Income" ||
    transaction?.Type === "Credit"
  );
}

function isExpense(transaction) {
  return (
    transaction?.Category === "Expense" ||
    transaction?.Type === "Expense" ||
    transaction?.Type === "Debit"
  );
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatCompact(value) {
  const number = Math.abs(Number(value) || 0);
  if (number >= 1000000) return `$${(number / 1000000).toFixed(2)}M`;
  if (number >= 1000) return `$${(number / 1000).toFixed(2)}K`;
  return `$${number.toFixed(2)}`;
}

function investmentKind(account) {
  const type = String(account?.accountType || "").toLowerCase();
  const name = String(account?.name || "").toLowerCase();

  if (type === "tfsa" || name.includes("tfsa")) return "tfsa";
  if (type === "crypto" || name.includes("crypto")) return "crypto";
  return null;
}

function investmentTimeline(transactions, portfolio) {
  const accountKinds = new Map();

  for (const account of portfolio?.accounts || []) {
    const kind = investmentKind(account);
    if (kind) accountKinds.set(Number(account.id), kind);
  }

  const states = new Map([
    ["tfsa", { cashMinor: 0, positions: new Map() }],
    ["crypto", { cashMinor: 0, positions: new Map() }]
  ]);

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime()
  );

  function currentValue() {
    let totalMinor = 0;

    for (const state of states.values()) {
      totalMinor += state.cashMinor;

      for (const position of state.positions.values()) {
        totalMinor += Math.round(
          position.quantity * position.priceMicros / 10000
        );
      }
    }

    return totalMinor / 100;
  }

  const timeline = [];

  for (const transaction of sorted) {
    const accountName = String(transaction?.Account || "").toLowerCase();
    let kind = null;

    if (accountName.includes("tfsa")) kind = "tfsa";
    if (accountName.includes("crypto")) kind = "crypto";
    if (!kind) kind = accountKinds.get(Number(transaction?.PortfolioAccountId));
    if (!kind) continue;

    const timestamp = new Date(transaction.Timestamp).getTime();
    if (!Number.isFinite(timestamp)) continue;

    const state = states.get(kind);
    const amountMinor = Number.isFinite(Number(transaction.AmountMinor))
      ? Number(transaction.AmountMinor)
      : Math.round(amountOf(transaction) * 100);

    const action = String(transaction?.PortfolioAction || "").toUpperCase();
    const flow = String(transaction?.AccountFlow || "").toUpperCase();

    if (flow === "IN") state.cashMinor += amountMinor;
    else if (flow === "OUT") state.cashMinor -= amountMinor;
    else if (action === "BUY") state.cashMinor -= amountMinor;
    else if ([
      "SELL", "DIVIDEND", "INTEREST", "REIMBURSEMENT",
      "CONTRIBUTION", "DEPOSIT"
    ].includes(action)) state.cashMinor += amountMinor;
    else if (["WITHDRAWAL", "FEE", "TAX"].includes(action)) {
      state.cashMinor -= amountMinor;
    }

    const symbol = String(transaction?.PortfolioSymbol || "")
      .trim()
      .toUpperCase();
    const quantity = Number(transaction?.PortfolioQuantity);
    const price = Number(transaction?.PortfolioPrice);

    let position = symbol ? state.positions.get(symbol) : null;

    if (symbol && !position) {
      position = { quantity: 0, priceMicros: 0 };
      state.positions.set(symbol, position);
    }

    if (position && Number.isFinite(price) && price > 0) {
      position.priceMicros = Math.round(price * 1000000);
    }

    if (position && Number.isFinite(quantity)) {
      if (action === "BUY") position.quantity += Math.abs(quantity);
      else if (action === "SELL" || action === "FEE") {
        position.quantity -= Math.abs(quantity);
      } else if (["REWARD", "DISTRIBUTION"].includes(action)) {
        position.quantity += quantity;
      }
    }

    timeline.push({ timestamp, value: currentValue() });
  }

  const portfolioValueMinor = (portfolio?.accounts || [])
    .filter(account => investmentKind(account))
    .reduce((sum, account) => sum + Number(account?.totalValueMinor || 0), 0);

  if ((portfolio?.accounts || []).length) {
    timeline.push({
      timestamp: Date.now(),
      value: portfolioValueMinor / 100
    });
  }

  return timeline.sort((a, b) => a.timestamp - b.timestamp);
}

function dailyInvestmentValues(timeline, year, month, daysInMonth) {
  const start = new Date(year, month, 1).getTime();
  let index = 0;
  let latest = 0;

  while (index < timeline.length && timeline[index].timestamp < start) {
    latest = Number(timeline[index].value) || 0;
    index++;
  }

  const opening = latest;
  const values = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const endOfDay = new Date(year, month, day + 1).getTime() - 1;

    while (
      index < timeline.length &&
      timeline[index].timestamp <= endOfDay
    ) {
      latest = Number(timeline[index].value) || 0;
      index++;
    }

    values.push(latest - opening);
  }

  return values;
}

function buildStats(transactions, portfolio) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const current = transactions.filter(transaction => {
    const date = new Date(transaction.Timestamp);
    return date.getFullYear() === year && date.getMonth() === month;
  });

  const incomeByDay = Array(daysInMonth).fill(0);
  const expenseByDay = Array(daysInMonth).fill(0);

  for (const transaction of current) {
    const day = new Date(transaction.Timestamp).getDate();
    const amount = amountOf(transaction);
    if (day < 1 || day > daysInMonth) continue;

    if (isIncome(transaction)) incomeByDay[day - 1] += amount;
    else if (isExpense(transaction)) expenseByDay[day - 1] += amount;
  }

  const totalIncome = incomeByDay.reduce((sum, value) => sum + value, 0);
  const totalExpense = expenseByDay.reduce((sum, value) => sum + value, 0);
  const balance = totalIncome - totalExpense;

  const previousDate = new Date(year, month - 1, 1);
  const previousTransactions = transactions.filter(transaction => {
    const date = new Date(transaction.Timestamp);
    return (
      date.getFullYear() === previousDate.getFullYear() &&
      date.getMonth() === previousDate.getMonth()
    );
  });

  const maxDay = current.length
    ? Math.max(...current.map(transaction => new Date(transaction.Timestamp).getDate()))
    : now.getDate();

  let previousIncome = 0;
  let previousExpense = 0;

  for (const transaction of previousTransactions) {
    if (new Date(transaction.Timestamp).getDate() > maxDay) continue;
    if (isIncome(transaction)) previousIncome += amountOf(transaction);
    else if (isExpense(transaction)) previousExpense += amountOf(transaction);
  }

  const previousBalance = previousIncome - previousExpense;
  const percentageChange = previousBalance === 0
    ? null
    : Math.round(((balance - previousBalance) / Math.abs(previousBalance)) * 100);

  const timeline = investmentTimeline(transactions, portfolio);
  const investmentValues = dailyInvestmentValues(
    timeline,
    year,
    month,
    daysInMonth
  );

  const anchorDay = Math.min(daysInMonth, now.getDate());
  const startDay = Math.max(1, anchorDay - 11);
  const endDay = Math.min(daysInMonth, startDay + 11);
  const actualStartDay = Math.max(1, endDay - 11);
  const chartItems = [];

  for (let day = actualStartDay; day <= endDay; day++) {
    const currentInvestment = investmentValues[day - 1] || 0;
    const previousInvestment = day > 1 ? investmentValues[day - 2] || 0 : 0;

    chartItems.push({
      day: String(day),
      income: incomeByDay[day - 1] || 0,
      expense: expenseByDay[day - 1] || 0,
      investment: Math.max(0, currentInvestment - previousInvestment),
      active: day === now.getDate()
    });
  }

  return {
    year,
    month,
    totalIncome,
    totalExpense,
    balance,
    percentageChange,
    investmentTotal: investmentValues[anchorDay - 1] || 0,
    chartItems,
    maxChartTotal: Math.max(
      1,
      ...chartItems.map(item => item.income + item.expense + item.investment)
    )
  };
}

function roundedPath(x, y, width, height, radius) {
  const path = new Path();
  // Scriptable requires both horizontal and vertical corner sizes.
  path.addRoundedRect(
    new Rect(x, y, width, height),
    radius,
    radius
  );
  return path;
}

function fillRounded(context, x, y, width, height, radius, color) {
  context.setFillColor(color);
  context.addPath(roundedPath(x, y, width, height, radius));
  context.fillPath();
}

function strokeRounded(context, x, y, width, height, radius, color, lineWidth) {
  context.setStrokeColor(color);
  context.setLineWidth(lineWidth);
  context.addPath(roundedPath(x, y, width, height, radius));
  context.strokePath();
}

function drawText(context, text, x, y, width, height, font, color, alignment) {
  context.setFont(font);
  context.setTextColor(color);

  if (alignment === "center") context.setTextAlignedCenter();
  else if (alignment === "right") context.setTextAlignedRight();
  else context.setTextAlignedLeft();

  context.drawTextInRect(text, new Rect(x, y, width, height));
}

function fittedFont(context, text, size, maxWidth, bold = false) {
  let current = size;
  // DrawContext.measureText() is not available in Scriptable.
  // Use a conservative character-width estimate instead.
  const characterWidth = bold ? 0.70 : 0.58;

  while (current > 8) {
    const estimatedWidth = String(text).length * current * characterWidth;

    if (estimatedWidth <= maxWidth) {
      return bold
        ? Font.boldSystemFont(current)
        : Font.systemFont(current);
    }

    current -= 0.5;
  }

  return bold ? Font.boldSystemFont(8) : Font.systemFont(8);
}

function drawMetric(context, value, label, y, color) {
  const amount = formatCompact(value);

  drawText(
    context,
    amount,
    20,
    y,
    92,
    16,
    fittedFont(context, amount, 13.5, 92, true),
    color,
    "left"
  );

  fillRounded(context, 20, y + 20, 6, 6, 3, color);

  drawText(
    context,
    label,
    30,
    y + 16,
    82,
    13,
    Font.systemFont(10.5),
    MUTED,
    "left"
  );
}

function drawBar(context, x, bottom, height, color, alpha) {
  if (height <= 0) return;

  fillRounded(
    context,
    x,
    bottom - height,
    5,
    height,
    3,
    new Color(color, alpha)
  );

  strokeRounded(
    context,
    x,
    bottom - height,
    5,
    height,
    3,
    new Color(color, Math.min(1, alpha + 0.15)),
    1
  );
}

function drawTriangle(context, x, y, size, pointsDown, color) {
  const path = new Path();

  if (pointsDown) {
    path.move(new Point(x, y));
    path.addLine(new Point(x + size, y));
    path.addLine(new Point(x + size / 2, y + size * 0.78));
  } else {
    path.move(new Point(x + size / 2, y));
    path.addLine(new Point(x + size, y + size * 0.78));
    path.addLine(new Point(x, y + size * 0.78));
  }

  path.closeSubpath();
  context.setFillColor(color);
  context.addPath(path);
  context.fillPath();
}

function renderImage(stats) {
  const context = new DrawContext();
  context.size = new Size(WIDTH, HEIGHT);
  context.opaque = false;
  context.respectScreenScale = true;

  // Full-size card. No dark/gray background remains outside it.
  fillRounded(context, 0, 0, WIDTH, HEIGHT, 25, CARD);
  strokeRounded(context, 0.5, 0.5, WIDTH - 1, HEIGHT - 1, 25, new Color("#d49d81", 0.35), 1);

  drawText(
    context,
    "CASH-FLOW BALANCE",
    20,
    11,
    140,
    16,
    Font.boldSystemFont(11.5),
    PEACH,
    "left"
  );

  const period = new Date(stats.year, stats.month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });

  // Keep the date close to the title. Together they form one header block
  // centered on the same horizontal line as the badge and balance.
  drawText(context, period, 20, 28, 140, 16, Font.systemFont(11), FAINT, "left");

  const balance = `$${formatCurrency(stats.balance)}`;
  const balanceFont = balance.length <= 10
    ? Font.boldSystemFont(13.5)
    : fittedFont(context, balance, 14, 87, true);

  drawText(
    context,
    balance,
    231,
    16.5,
    87,
    18,
    balanceFont,
    stats.balance >= 0 ? GREEN : RED,
    "right"
  );

  if (stats.percentageChange !== null) {
    const badgeX = 175;
    const badgeY = 14;
    const badgeWidth = 52;
    const badgeHeight = 24;
    const badgeColor = stats.percentageChange >= 0 ? GREEN : RED;

    strokeRounded(
      context,
      badgeX,
      badgeY,
      badgeWidth,
      badgeHeight,
      12,
      new Color(stats.percentageChange >= 0 ? "#83ffc9" : "#ff6666", 0.45),
      1
    );

    // Draw the arrow as a shape to avoid the corrupted "a1/4" Unicode text.
    drawTriangle(
      context,
      badgeX + 11,
      badgeY + 10,
      6,
      stats.percentageChange < 0,
      badgeColor
    );

    const badgeText = `${Math.abs(stats.percentageChange)}%`;

    drawText(
      context,
      badgeText,
      badgeX + 19,
      badgeY + 6,
      badgeWidth - 19,
      14,
      fittedFont(context, badgeText, 10.5, badgeWidth - 21, true),
      badgeColor,
      "left"
    );
  }

  context.setFillColor(new Color("#ffffff", 0.07));
  context.fillRect(new Rect(20, 48, 298, 1));

  drawMetric(context, stats.totalIncome, "Inflow", 53, GREEN);
  drawMetric(context, stats.totalExpense, "Outflow", 84, RED);
  drawMetric(context, stats.investmentTotal, "Invest", 115, TEXT);

  const chartLeft = 116;
  const chartWidth = 202;
  const columnWidth = chartWidth / 12;
  const chartBottom = 130;
  const chartHeight = 62;

  for (let index = 0; index < stats.chartItems.length; index++) {
    const item = stats.chartItems[index];
    const x = chartLeft + index * columnWidth + (columnWidth - 5) / 2;
    const total = item.income + item.expense + item.investment;

    if (total <= 0) {
      fillRounded(context, x, chartBottom - 3, 5, 5, 2.5, new Color("#fff5f0", item.active ? 0.9 : 0.25));
    } else {
      const usableHeight = Math.max((total / stats.maxChartTotal) * chartHeight, 10);
      const activeCount =
        (item.investment > 0 ? 1 : 0) +
        (item.expense > 0 ? 1 : 0) +
        (item.income > 0 ? 1 : 0);

      let investmentHeight = 0;
      let expenseHeight = 0;
      let incomeHeight = 0;

      if (activeCount > 1) {
        investmentHeight = item.investment > 0
          ? Math.max(Math.round((item.investment / total) * usableHeight), 4)
          : 0;
        expenseHeight = item.expense > 0
          ? Math.max(Math.round((item.expense / total) * usableHeight), 4)
          : 0;
        incomeHeight = item.income > 0
          ? Math.max(Math.round((item.income / total) * usableHeight), 4)
          : 0;
      } else if (item.income > 0) {
        incomeHeight = Math.max(Math.round(usableHeight), 6);
      } else if (item.expense > 0) {
        expenseHeight = Math.max(Math.round(usableHeight), 6);
      } else {
        investmentHeight = Math.max(Math.round(usableHeight), 6);
      }

      const alpha = item.active ? 1 : 0.35;
      let bottom = chartBottom;

      drawBar(context, x, bottom, incomeHeight, "#83ffc9", alpha);
      bottom -= incomeHeight;

      if (expenseHeight > 0) {
        bottom -= 3;
        drawBar(context, x, bottom, expenseHeight, "#ff6666", alpha);
        bottom -= expenseHeight;
      }

      if (investmentHeight > 0) {
        bottom -= 3;
        drawBar(context, x, bottom, investmentHeight, "#fff5f0", alpha);
      }
    }

    drawText(
      context,
      item.day,
      x - 5,
      135,
      15,
      14,
      item.active ? Font.boldSystemFont(10) : Font.systemFont(10),
      item.active ? PEACH : FAINT,
      "center"
    );
  }

  return context.getImage();
}

function createErrorWidget(message) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#211f24");
  widget.setPadding(14, 14, 14, 14);

  const title = widget.addText("MoniMonitor");
  title.font = Font.boldSystemFont(15);
  title.textColor = PEACH;

  widget.addSpacer(5);

  const text = widget.addText(message);
  text.font = Font.systemFont(11);
  text.textColor = TEXT;
  text.lineLimit = 4;

  return widget;
}

try {
  const stats = await loadWidgetStats();
  const widget = new ListWidget();

  widget.backgroundColor = BG;
  widget.setPadding(0, 0, 0, 0);
  widget.backgroundImage = renderImage(stats);
  widget.url = "https://monimonitor.saeedarabha.com/insight";
  // This is the earliest requested update; iOS chooses the actual time.
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentMedium();
  }
} catch (error) {
  const message = error?.message || String(error);

  if (config.runsInWidget) {
    Script.setWidget(createErrorWidget(message));
  } else {
    await showMessage("MoniMonitor Widget Error", message);
  }
}

Script.complete();

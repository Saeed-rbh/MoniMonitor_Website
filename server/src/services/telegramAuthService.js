const crypto = require("crypto");

function validateTelegramInitData(initData, botToken, options = {}) {
    if (typeof initData !== "string" || !initData || initData.length > 10000) throw new Error("Invalid Telegram data");
    if (typeof botToken !== "string" || !botToken) throw new Error("Telegram authentication is not configured");

    const params = new URLSearchParams(initData);
    const hashes = params.getAll("hash");
    if (hashes.length !== 1 || !/^[a-f0-9]{64}$/i.test(hashes[0])) throw new Error("Invalid Telegram signature");

    const dataCheckString = [...params.entries()].filter(([key]) => key !== "hash").sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("\n");
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
    const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest();
    const suppliedHash = Buffer.from(hashes[0], "hex");
    if (suppliedHash.length !== expectedHash.length || !crypto.timingSafeEqual(suppliedHash, expectedHash)) throw new Error("Invalid Telegram signature");

    const now = options.now ?? Math.floor(Date.now() / 1000);
    const maxAgeSeconds = options.maxAgeSeconds ?? 600;
    const authDate = Number(params.get("auth_date"));
    if (!Number.isInteger(authDate) || authDate > now + 30 || now - authDate > maxAgeSeconds) throw new Error("Expired Telegram authentication");

    let user;
    try { user = JSON.parse(params.get("user") || "null"); } catch { throw new Error("Invalid Telegram user"); }
    if (!user || !Number.isSafeInteger(Number(user.id))) throw new Error("Invalid Telegram user");
    return user;
}

function normalizeTelegramPhotoUrl(value) {
    if (typeof value !== "string" || !value || value.length > 2048) return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" ? url.toString() : null;
    } catch {
        return null;
    }
}

module.exports = { validateTelegramInitData, normalizeTelegramPhotoUrl };

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { validateTelegramInitData, normalizeTelegramPhotoUrl } = require("./telegramAuthService");

const botToken = "123456:test-token";
const now = 1777500000;

function signedInitData(overrides = {}) {
    const values = {
        auth_date: String(now),
        query_id: "test-query",
        user: JSON.stringify({ id: 12345, first_name: "Saeed" }),
        ...overrides,
    };
    const dataCheckString = Object.entries(values)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
    values.hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    return new URLSearchParams(values).toString();
}

test("accepts authentic Telegram Mini App data", () => {
    const user = validateTelegramInitData(signedInitData(), botToken, { now });
    assert.equal(user.id, 12345);
});

test("rejects tampered Telegram Mini App data", () => {
    const tampered = signedInitData().replace("Saeed", "Mallory");
    assert.throws(() => validateTelegramInitData(tampered, botToken, { now }), /signature/);
});

test("rejects expired Telegram Mini App data", () => {
    assert.throws(
        () => validateTelegramInitData(signedInitData(), botToken, { now: now + 601 }),
        /Expired/
    );
});

test("accepts HTTPS Telegram profile photo URLs", () => {
    assert.equal(
        normalizeTelegramPhotoUrl("https://t.me/i/userpic/320/example.jpg"),
        "https://t.me/i/userpic/320/example.jpg"
    );
});

test("rejects unsafe Telegram profile photo URLs", () => {
    assert.equal(normalizeTelegramPhotoUrl("http://example.com/photo.jpg"), null);
    assert.equal(normalizeTelegramPhotoUrl("javascript:alert(1)"), null);
    assert.equal(normalizeTelegramPhotoUrl("not a URL"), null);
});

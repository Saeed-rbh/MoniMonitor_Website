const crypto = require('crypto');

const ENCRYPTED_PREFIX = 'enc:v1:';
// Local development and isolated tests need a key without persisting a secret
// in source control. Production always requires an operator-provided key.
const developmentSecret = crypto.randomBytes(32).toString('base64url');

function configuredSecret(name) {
    const secret = process.env[name] || process.env.JWT_SECRET ||
        (process.env.NODE_ENV !== 'production' ? developmentSecret : null);
    if (!secret || String(secret).trim().length < 16) {
        throw new Error(`${name} (or a strong JWT_SECRET) must be configured to protect sensitive data`);
    }
    return crypto.createHash('sha256').update(String(secret)).digest();
}

function encryptString(value, keyName) {
    if (value === null || value === undefined) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', configuredSecret(keyName), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return ENCRYPTED_PREFIX + [iv, cipher.getAuthTag(), encrypted]
        .map((part) => part.toString('base64url')).join('.');
}

function decryptString(value, keyName) {
    if (value === null || value === undefined) return value;
    const serialized = String(value);
    if (!serialized.startsWith(ENCRYPTED_PREFIX)) return serialized; // legacy data is migrated on startup
    const [ivValue, tagValue, encryptedValue] = serialized.slice(ENCRYPTED_PREFIX.length).split('.');
    if (!ivValue || !tagValue || !encryptedValue) throw new Error('Invalid encrypted payload');
    const decipher = crypto.createDecipheriv('aes-256-gcm', configuredSecret(keyName), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

module.exports = { encryptString, decryptString, isEncrypted, ENCRYPTED_PREFIX };

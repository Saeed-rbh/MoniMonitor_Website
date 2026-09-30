const crypto = require('crypto');
const { keyRing } = require('./encryptionKeys');

const ENCRYPTED_PREFIX = 'enc:v2:';
const LEGACY_PREFIX = 'enc:v1:';

function configuredSecret(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest();
}

function encryptString(value, keyName) {
    if (value === null || value === undefined) return null;
    const ring = keyRing(keyName);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', configuredSecret(ring.secret), iv);
    cipher.setAAD(Buffer.from(`${keyName}:${ring.id}`));
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return ENCRYPTED_PREFIX + ring.id + ':' + [iv, cipher.getAuthTag(), encrypted]
        .map((part) => part.toString('base64url')).join('.');
}

function decryptStringWithMetadata(value, keyName) {
    if (value === null || value === undefined) return { value, needsRotation: false };
    const serialized = String(value);
    if (!serialized.startsWith('enc:')) return { value: serialized, needsRotation: true };
    const ring = keyRing(keyName);
    const legacy = serialized.startsWith(LEGACY_PREFIX);
    if (!legacy && !serialized.startsWith(ENCRYPTED_PREFIX)) throw new Error('Unsupported encrypted payload version');
    const content = serialized.slice(legacy ? LEGACY_PREFIX.length : ENCRYPTED_PREFIX.length);
    const colon = content.indexOf(':');
    const id = legacy ? null : content.slice(0, colon);
    if (!legacy && (colon < 1 || !/^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new Error('Invalid encryption key ID');
    const parts = (legacy ? content : content.slice(colon + 1)).split('.');
    if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]*$/.test(part))) throw new Error('Invalid encrypted payload');
    const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16 || [iv, tag, encrypted].some((part, index) => part.toString('base64url') !== parts[index])) throw new Error('Invalid encrypted payload');
    const secrets = legacy ? [...new Set([ring.secret, ...Object.values(ring.previous), ring.legacySecret].filter(Boolean))]
        : [id === ring.id ? ring.secret : ring.previous[id]].filter(Boolean);
    if (!secrets.length) throw new Error('Encryption key is unavailable; restore the required previous key');
    for (const secret of secrets) {
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', configuredSecret(secret), iv);
            if (!legacy) decipher.setAAD(Buffer.from(`${keyName}:${id}`));
            decipher.setAuthTag(tag);
            const decoded = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
            return { value: decoded, needsRotation: legacy || id !== ring.id, keyId: id };
        } catch { /* Try only explicitly configured legacy keys. */ }
    }
    throw new Error('Encrypted payload authentication failed');
}

const decryptString = (value, keyName) => decryptStringWithMetadata(value, keyName).value;

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith('enc:');
}

module.exports = { encryptString, decryptString, decryptStringWithMetadata, isEncrypted, ENCRYPTED_PREFIX };

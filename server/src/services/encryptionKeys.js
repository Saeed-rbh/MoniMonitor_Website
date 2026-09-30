const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const PURPOSES = ['EMAIL_SOURCE_ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_KEY', 'PLAID_TOKEN_ENCRYPTION_KEY'];
const validId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
const keyId = (secret) => crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16);

function developmentKeys(env) {
    const databasePath = env.MONIMONITOR_DB_PATH ? path.resolve(env.MONIMONITOR_DB_PATH)
        : path.join(__dirname, '..', '..', 'monimonitor.sqlite');
    const file = env.MONIMONITOR_ENCRYPTION_KEY_FILE ? path.resolve(env.MONIMONITOR_ENCRYPTION_KEY_FILE)
        : `${databasePath}.encryption-keys.local`;
    if (!fs.existsSync(file)) {
        const keys = Object.fromEntries(PURPOSES.map((name) => [name, crypto.randomBytes(32).toString('base64url')]));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        try { fs.writeFileSync(file, JSON.stringify(keys), { flag: 'wx', mode: 0o600 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const keys = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!keys || PURPOSES.some((name) => typeof keys[name] !== 'string' || keys[name].length < 32)) {
        throw new Error('Local encryption key file is invalid; restore it instead of generating replacement keys');
    }
    return keys;
}

function keyRing(name, env = process.env) {
    if (!PURPOSES.includes(name)) throw new Error('Unknown encryption purpose');
    const secret = env[name] || (env.NODE_ENV !== 'production' ? developmentKeys(env)[name] : null);
    if (typeof secret !== 'string' || secret.trim().length < 32 || /^replace_with_|^your_/i.test(secret)) {
        throw new Error(`${name} must contain a dedicated secret of at least 32 characters`);
    }
    if (secret === env.JWT_SECRET) throw new Error(`${name} must be separate from JWT_SECRET`);
    const id = env[`${name}_ID`] || keyId(secret);
    if (!validId(id)) throw new Error(`${name}_ID is invalid`);
    let previous;
    try { previous = JSON.parse(env[`${name}_PREVIOUS_KEYS`] || '{}'); }
    catch { throw new Error(`${name}_PREVIOUS_KEYS must be a JSON object of key IDs and secrets`); }
    if (!previous || Array.isArray(previous) || typeof previous !== 'object' || Object.entries(previous).some(([oldId, value]) =>
        !validId(oldId) || oldId === id || typeof value !== 'string' || value.trim().length < 16)) {
        throw new Error(`${name}_PREVIOUS_KEYS contains an invalid or duplicate key`);
    }
    return { id, secret, previous, legacySecret: env[`${name}_LEGACY_KEY`] || env.JWT_SECRET || null };
}

function validateEncryptionConfiguration(env = process.env) {
    const rings = PURPOSES.map((name) => keyRing(name, env));
    if (new Set(rings.map((ring) => ring.secret)).size !== rings.length) throw new Error('Encryption purposes must use distinct keys');
    return true;
}

module.exports = { keyRing, validateEncryptionConfiguration, PURPOSES };

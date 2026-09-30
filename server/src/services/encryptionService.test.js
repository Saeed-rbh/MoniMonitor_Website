const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { encryptString, decryptString, decryptStringWithMetadata } = require('./encryptionService');
const { validateEncryptionConfiguration, keyRing, PURPOSES } = require('./encryptionKeys');
const { encryptFile, decryptFile } = require('./encryptedFileService');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monimonitor-encryption-'));
const saved = { ...process.env };
test.before(() => {
  process.env.MONIMONITOR_ENCRYPTION_KEY_FILE = path.join(directory, 'keys.local');
  for (const name of PURPOSES) {
    delete process.env[name]; delete process.env[`${name}_ID`];
    delete process.env[`${name}_PREVIOUS_KEYS`]; delete process.env[`${name}_LEGACY_KEY`];
  }
  process.env.NODE_ENV = 'development';
});
test.after(() => {
  for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
  fs.rmSync(directory, { recursive: true, force: true });
});

function legacy(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(secret).digest(), iv);
  const contents = Buffer.concat([cipher.update(value), cipher.final()]);
  return 'enc:v1:' + [iv, cipher.getAuthTag(), contents].map((part) => part.toString('base64url')).join('.');
}

test('development ciphertext remains readable in a fresh process with durable separate keys', () => {
  const ciphertext = encryptString('restart-safe', 'EMAIL_SOURCE_ENCRYPTION_KEY');
  assert.equal(validateEncryptionConfiguration(), true);
  assert.ok(fs.existsSync(process.env.MONIMONITOR_ENCRYPTION_KEY_FILE));
  const modulePath = require.resolve('./encryptionService');
  const script = 'const {decryptString}=require(process.argv[1]);process.stdout.write(decryptString(process.argv[2],"EMAIL_SOURCE_ENCRYPTION_KEY"));';
  assert.equal(execFileSync(process.execPath, ['-e', script, modulePath, ciphertext], { env: process.env, encoding: 'utf8' }), 'restart-safe');
});

test('versioned keys support rotation and reject missing recovery keys', () => {
  const name = 'EMAIL_SOURCE_ENCRYPTION_KEY';
  process.env[name] = crypto.randomBytes(32).toString('base64url');
  process.env[`${name}_ID`] = 'email-old';
  const oldSecret = process.env[name];
  const old = encryptString('evidence', name);
  process.env[name] = crypto.randomBytes(32).toString('base64url');
  process.env[`${name}_ID`] = 'email-new';
  process.env[`${name}_PREVIOUS_KEYS`] = JSON.stringify({ 'email-old': oldSecret });
  assert.deepEqual(decryptStringWithMetadata(old, name), { value: 'evidence', needsRotation: true, keyId: 'email-old' });
  const current = encryptString(decryptString(old, name), name);
  assert.equal(decryptStringWithMetadata(current, name).needsRotation, false);
  delete process.env[`${name}_PREVIOUS_KEYS`];
  assert.throws(() => decryptString(old, name), /key is unavailable/);
  assert.equal(decryptString(current, name), 'evidence');
});

test('legacy JWT-encrypted evidence remains readable and is marked for migration', () => {
  const name = 'EMAIL_SOURCE_ENCRYPTION_KEY';
  process.env[`${name}_LEGACY_KEY`] = 'original-jwt-secret';
  const old = legacy('legacy-evidence', process.env[`${name}_LEGACY_KEY`]);
  assert.equal(decryptString(old, name), 'legacy-evidence');
  assert.equal(decryptStringWithMetadata(old, name).needsRotation, true);
  assert.equal(decryptStringWithMetadata('{"old":"plaintext"}', name).needsRotation, true);
});

test('authenticated ciphertext rejects tampering, purpose substitution and unknown versions', () => {
  const name = 'EMAIL_SOURCE_ENCRYPTION_KEY';
  const encrypted = encryptString('private-value', name);
  const parts = encrypted.split(':');
  const payload = parts[3].split('.');
  const ciphertext = Buffer.from(payload[2], 'base64url'); ciphertext[0] ^= 1;
  payload[2] = ciphertext.toString('base64url');
  assert.throws(() => decryptString(parts.slice(0, 3).join(':') + ':' + payload.join('.'), name), /authentication failed/);
  process.env.BACKUP_ENCRYPTION_KEY = process.env[name];
  process.env.BACKUP_ENCRYPTION_KEY_ID = process.env[`${name}_ID`];
  assert.throws(() => decryptString(encrypted, 'BACKUP_ENCRYPTION_KEY'), /authentication failed/);
  delete process.env.BACKUP_ENCRYPTION_KEY; delete process.env.BACKUP_ENCRYPTION_KEY_ID;
  assert.throws(() => decryptString('enc:v3:unknown', name), /Unsupported/);
  assert.equal(decryptString(encryptString('', name), name), '');
});

test('production requires strong independent keys and rejects invalid rotation metadata', () => {
  assert.throws(() => validateEncryptionConfiguration({ NODE_ENV: 'production', JWT_SECRET: 's'.repeat(40) }), /dedicated secret/);
  const environment = { NODE_ENV: 'production', JWT_SECRET: 'j'.repeat(40),
    ...Object.fromEntries(PURPOSES.map((name, index) => [name, String(index).repeat(40)])) };
  assert.equal(validateEncryptionConfiguration(environment), true);
  assert.throws(() => validateEncryptionConfiguration({ ...environment, BACKUP_ENCRYPTION_KEY: environment.JWT_SECRET }), /separate/);
  assert.throws(() => validateEncryptionConfiguration({ ...environment, BACKUP_ENCRYPTION_KEY: environment.EMAIL_SOURCE_ENCRYPTION_KEY }), /distinct/);
  assert.throws(() => keyRing('BACKUP_ENCRYPTION_KEY', { ...environment, BACKUP_ENCRYPTION_KEY_PREVIOUS_KEYS: 'invalid' }), /JSON object/);
  assert.throws(() => keyRing('BACKUP_ENCRYPTION_KEY', { ...environment, BACKUP_ENCRYPTION_KEY_ID: 'same', BACKUP_ENCRYPTION_KEY_PREVIOUS_KEYS: '{"same":"previous-key-at-least-32-characters"}' }), /duplicate/);
});

test('retained encrypted backups and legacy files restore after key rotation', async () => {
  const name = 'BACKUP_ENCRYPTION_KEY';
  const original = path.join(directory, 'original.sqlite');
  const encrypted = path.join(directory, 'snapshot.enc');
  const restored = path.join(directory, 'restored.sqlite');
  const bytes = Buffer.from([0, 1, 2, 255, 254, 0]); fs.writeFileSync(original, bytes);
  process.env[name] = crypto.randomBytes(32).toString('base64url'); process.env[`${name}_ID`] = 'backup-old';
  const secret = process.env[name];
  await encryptFile(original, encrypted);
  process.env[name] = crypto.randomBytes(32).toString('base64url'); process.env[`${name}_ID`] = 'backup-new';
  process.env[`${name}_PREVIOUS_KEYS`] = JSON.stringify({ 'backup-old': secret });
  assert.equal(await decryptFile(encrypted, restored), true);
  assert.deepEqual(fs.readFileSync(restored), bytes);
  fs.writeFileSync(encrypted, 'MONIMONITOR-ENC-V1\n' + legacy(bytes.toString('base64'), secret));
  assert.equal(await decryptFile(encrypted, restored), true);
  assert.deepEqual(fs.readFileSync(restored), bytes);
});

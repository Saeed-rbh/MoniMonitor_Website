const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafeBackupFileName, selectBackupNamesToKeep, verifyCopiedFile } = require('./backupService');
test('offsite readback rejects corrupted copies', async () => {
    const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monimonitor-copy-'));
    try {
        const original = path.join(directory, 'original'), copy = path.join(directory, 'copy');
        await fs.writeFile(original, 'encrypted database'); await fs.writeFile(copy, 'encrypted database');
        await verifyCopiedFile(original, copy);
        await fs.writeFile(copy, 'corrupted'); await assert.rejects(verifyCopiedFile(original, copy), /readback/);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('accepts generated backup names and rejects path traversal', () => {
    assert.equal(isSafeBackupFileName('monimonitor-2026-08-13T19-15-20-123Z-manual-deadbeef.sqlite'), true);
    assert.equal(isSafeBackupFileName('../monimonitor.sqlite'), false);
    assert.equal(isSafeBackupFileName('other.sqlite'), false);
});

test('retains recent manual backups plus daily, weekly, and monthly automatic recovery points', () => {
    const backups = Array.from({ length: 15 }, (_, index) => ({
        fileName: `manual-${index}`,
        reason: 'manual',
        createdAt: new Date(Date.UTC(2026, 7, 15 - index)).toISOString(),
    }));
    backups.push(...Array.from({ length: 40 }, (_, index) => ({
        fileName: `automatic-${index}`,
        reason: 'automatic',
        createdAt: new Date(Date.UTC(2026, 7, 15 - index)).toISOString(),
    })));

    const keep = selectBackupNamesToKeep(backups);
    assert.equal([...keep].filter((name) => name.startsWith('manual-')).length, 10);
    assert.ok([...keep].some((name) => name.startsWith('automatic-')));
    assert.ok(keep.size > 10);
});

const fs = require('fs/promises');
const { encryptString, decryptString, ENCRYPTED_PREFIX } = require('./encryptionService');

const FILE_PREFIX = Buffer.from('MONIMONITOR-ENC-V1\n');

async function encryptFile(sourcePath, destinationPath) {
    const contents = await fs.readFile(sourcePath);
    const encrypted = encryptString(contents.toString('base64'), 'BACKUP_ENCRYPTION_KEY');
    await fs.writeFile(destinationPath, Buffer.concat([FILE_PREFIX, Buffer.from(encrypted, 'utf8')]));
}

async function decryptFile(sourcePath, destinationPath) {
    const contents = await fs.readFile(sourcePath);
    if (!contents.subarray(0, FILE_PREFIX.length).equals(FILE_PREFIX)) {
        await fs.copyFile(sourcePath, destinationPath); // legacy .sqlite recovery point
        return false;
    }
    const encrypted = contents.subarray(FILE_PREFIX.length).toString('utf8');
    if (!encrypted.startsWith(ENCRYPTED_PREFIX)) throw new Error('Invalid encrypted backup file');
    const decoded = decryptString(encrypted, 'BACKUP_ENCRYPTION_KEY');
    await fs.writeFile(destinationPath, Buffer.from(decoded, 'base64'));
    return true;
}

module.exports = { encryptFile, decryptFile };

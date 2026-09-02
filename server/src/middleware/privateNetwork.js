const net = require("net");

function normalizedAddress(value) {
    const address = String(value || "").trim().toLowerCase();
    return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function isLoopbackAddress(value) {
    const address = normalizedAddress(value);
    return address === "::1" || address === "localhost" || address.startsWith("127.");
}

function isPrivateNetworkAddress(value) {
    const address = normalizedAddress(value);
    if (isLoopbackAddress(address)) return true;

    if (net.isIP(address) === 4) {
        const [first, second] = address.split(".").map(Number);
        return first === 10 || first === 127 ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168) ||
            (first === 100 && second >= 64 && second <= 127);
    }

    return net.isIP(address) === 6 && (
        address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")
    );
}

function backupPrivateNetworkOnly(env = process.env) {
    return env.BACKUP_PRIVATE_NETWORK_ONLY === "true";
}

function requirePrivateBackupNetwork(req, res, next) {
    if (!backupPrivateNetworkOnly()) return next();
    const sourceAddress = req.ip || req.socket?.remoteAddress;
    if (!isPrivateNetworkAddress(sourceAddress)) {
        return res.status(403).json({ error: "Backup administration is available only from a private network" });
    }
    return next();
}

module.exports = {
    normalizedAddress,
    isLoopbackAddress,
    isPrivateNetworkAddress,
    backupPrivateNetworkOnly,
    requirePrivateBackupNetwork,
};

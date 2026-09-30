const net = require('node:net');

function proxyTrust(env = process.env) {
    const configured = String(env.TRUSTED_PROXIES ?? 'loopback').trim();
    if (configured === 'false') return false;
    const addresses = configured.split(',').map((value) => value.trim());
    for (const address of addresses) {
        if (address === 'loopback') continue;
        const [ip, prefix, extra] = address.split('/');
        const version = net.isIP(ip);
        const maxPrefix = version === 4 ? 32 : 128;
        if (!version || extra !== undefined || (prefix !== undefined &&
            (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > maxPrefix))) {
            throw new Error('TRUSTED_PROXIES must be false, loopback, or explicit proxy IP addresses/CIDRs');
        }
    }
    return addresses;
}

module.exports = { proxyTrust };

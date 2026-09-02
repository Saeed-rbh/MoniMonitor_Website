const assert = require("node:assert/strict");
const test = require("node:test");
const {
    isPrivateNetworkAddress,
    isLoopbackAddress,
    backupPrivateNetworkOnly,
    requirePrivateBackupNetwork,
} = require("./privateNetwork");

test("recognizes loopback, RFC1918, and Tailscale network addresses", () => {
    ["127.0.0.1", "::1", "::ffff:127.0.0.1", "10.0.0.8", "172.20.1.2", "192.168.1.2", "100.101.102.103", "fd7a:115c:a1e0::1"].forEach((address) => {
        assert.equal(isPrivateNetworkAddress(address), true, address);
    });
    ["8.8.8.8", "172.32.1.2", "203.0.113.4", "2001:4860:4860::8888"].forEach((address) => {
        assert.equal(isPrivateNetworkAddress(address), false, address);
    });
});

test("identifies loopback addresses without treating an entire private LAN as loopback", () => {
    assert.equal(isLoopbackAddress("127.0.0.1"), true);
    assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
    assert.equal(isLoopbackAddress("10.0.0.8"), false);
});

test("private backup mode is disabled unless explicitly enabled", () => {
    assert.equal(backupPrivateNetworkOnly({}), false);
    assert.equal(backupPrivateNetworkOnly({ BACKUP_PRIVATE_NETWORK_ONLY: "true" }), true);
});

test("private backup middleware rejects public source addresses when enabled", () => {
    const results = [];
    const res = { status: (code) => ({ json: (payload) => results.push({ code, payload }) }) };
    let nextCalls = 0;
    const previous = process.env.BACKUP_PRIVATE_NETWORK_ONLY;
    process.env.BACKUP_PRIVATE_NETWORK_ONLY = "true";
    requirePrivateBackupNetwork({ ip: "203.0.113.4" }, res, () => { nextCalls += 1; });
    requirePrivateBackupNetwork({ ip: "127.0.0.1" }, res, () => { nextCalls += 1; });
    if (previous === undefined) delete process.env.BACKUP_PRIVATE_NETWORK_ONLY;
    else process.env.BACKUP_PRIVATE_NETWORK_ONLY = previous;

    assert.equal(nextCalls, 1);
    assert.deepEqual(results, [{
        code: 403,
        payload: { error: "Backup administration is available only from a private network" },
    }]);
});

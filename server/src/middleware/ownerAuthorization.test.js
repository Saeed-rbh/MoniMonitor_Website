const assert = require("node:assert/strict");
const test = require("node:test");
const {
    configuredOwnerId,
    isConfiguredOwner,
    createOwnerAuthorization,
} = require("./ownerAuthorization");

test("uses the dedicated backup owner id when configured", () => {
    assert.equal(configuredOwnerId({ BACKUP_OWNER_USER_ID: "backup-owner", USER_ID: "agent-owner" }), "backup-owner");
});

test("uses the agent owner id as the backwards-compatible fallback", () => {
    assert.equal(configuredOwnerId({ USER_ID: "agent-owner" }), "agent-owner");
    assert.equal(configuredOwnerId({}), null);
});

test("matches only the configured owner", () => {
    assert.equal(isConfiguredOwner("owner", "owner"), true);
    assert.equal(isConfiguredOwner("other-user", "owner"), false);
    assert.equal(isConfiguredOwner("owner", null), false);
});

test("owner middleware rejects missing configuration, non-owner sessions, and an unassigned owner role", async () => {
    const results = [];
    const res = { status: (code) => ({ json: (payload) => results.push({ code, payload }) }) };
    let nextCalls = 0;

    const prior = process.env.BACKUP_OWNER_USER_ID;
    const priorUserId = process.env.USER_ID;
    delete process.env.BACKUP_OWNER_USER_ID;
    delete process.env.USER_ID;
    const middleware = createOwnerAuthorization({
        getUserById: async (id) => id === "owner" ? { id, role: "owner" } : null,
    });
    const unassignedMiddleware = createOwnerAuthorization({
        getUserById: async () => ({ id: "owner", role: "user" }),
    });

    await middleware({ user: { userId: "owner" } }, res, () => { nextCalls += 1; });

    process.env.BACKUP_OWNER_USER_ID = "owner";
    await middleware({ user: { userId: "other" } }, res, () => { nextCalls += 1; });
    await unassignedMiddleware({ user: { userId: "owner" } }, res, () => { nextCalls += 1; });
    await middleware({ user: { userId: "owner" } }, res, () => { nextCalls += 1; });

    if (prior === undefined) delete process.env.BACKUP_OWNER_USER_ID;
    else process.env.BACKUP_OWNER_USER_ID = prior;
    if (priorUserId === undefined) delete process.env.USER_ID;
    else process.env.USER_ID = priorUserId;

    assert.deepEqual(results, [
        { code: 503, payload: { error: "Backup administration is not configured" } },
        { code: 403, payload: { error: "Owner authorization is required" } },
        { code: 403, payload: { error: "Owner authorization is required" } },
    ]);
    assert.equal(nextCalls, 1);
});

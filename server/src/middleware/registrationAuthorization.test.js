const assert = require("node:assert/strict");
const test = require("node:test");
const { registrationsExplicitlyEnabled, createRegistrationAuthorization } = require("./registrationAuthorization");

test("registration is closed by default and requires an explicit temporary opt-in", () => {
    assert.equal(registrationsExplicitlyEnabled({}), false);
    assert.equal(registrationsExplicitlyEnabled({ REGISTRATION_ENABLED: "false" }), false);
    assert.equal(registrationsExplicitlyEnabled({ REGISTRATION_ENABLED: "true" }), true);
});

test("registration middleware allows the initial account but blocks later public accounts", async () => {
    const results = [];
    const res = { status: (code) => ({ json: (payload) => results.push({ code, payload }) }) };
    let nextCalls = 0;
    const previous = process.env.REGISTRATION_ENABLED;
    delete process.env.REGISTRATION_ENABLED;

    await createRegistrationAuthorization({ getUserCount: async () => 0 })({}, res, () => { nextCalls += 1; });
    await createRegistrationAuthorization({ getUserCount: async () => 1 })({}, res, () => { nextCalls += 1; });

    if (previous === undefined) delete process.env.REGISTRATION_ENABLED;
    else process.env.REGISTRATION_ENABLED = previous;

    assert.equal(nextCalls, 1);
    assert.deepEqual(results, [{ code: 403, payload: { error: "Registration is closed" } }]);
});

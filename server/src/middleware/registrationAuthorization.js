function registrationsExplicitlyEnabled(env = process.env) {
    return env.REGISTRATION_ENABLED === "true";
}

function createRegistrationAuthorization({ getUserCount } = {}) {
    if (typeof getUserCount !== "function") throw new Error("getUserCount is required");

    return async (_req, res, next) => {
        if (registrationsExplicitlyEnabled()) return next();
        try {
            if (await getUserCount() > 0) {
                return res.status(403).json({ error: "Registration is closed" });
            }
            return next();
        } catch (error) {
            return next(error);
        }
    };
}

module.exports = { registrationsExplicitlyEnabled, createRegistrationAuthorization };

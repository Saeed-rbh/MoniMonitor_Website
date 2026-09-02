const dbService = require("../database/dbService");

function configuredOwnerId(env = process.env) {
    const value = env.BACKUP_OWNER_USER_ID || env.USER_ID;
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isConfiguredOwner(userId, ownerId = configuredOwnerId()) {
    return Boolean(ownerId) && String(userId) === ownerId;
}

function createOwnerAuthorization({ getUserById = dbService.getUserById } = {}) {
    return async (req, res, next) => {
        const ownerId = configuredOwnerId();
        if (!ownerId) {
            return res.status(503).json({ error: "Backup administration is not configured" });
        }
        if (!isConfiguredOwner(req.user?.userId, ownerId)) {
            return res.status(403).json({ error: "Owner authorization is required" });
        }

        try {
            const owner = await getUserById(ownerId);
            if (owner?.role !== "owner") {
                return res.status(403).json({ error: "Owner authorization is required" });
            }
            return next();
        } catch (error) {
            return next(error);
        }
    };
}

const requireConfiguredOwner = createOwnerAuthorization();

module.exports = {
    configuredOwnerId,
    isConfiguredOwner,
    createOwnerAuthorization,
    requireConfiguredOwner,
};

const { configuredOwnerId } = require('./ownerAuthorization');

function singleTenantEnabled(env = process.env) {
    return env.SINGLE_TENANT_MODE !== 'false';
}

function requireSingleTenant(req, res, next) {
    if (!singleTenantEnabled()) return next();
    const ownerId = configuredOwnerId();
    if (!ownerId) return res.status(503).json({ error: 'Single-tenant owner is not configured' });
    if (String(req.user?.userId) !== ownerId) return res.status(403).json({ error: 'This installation is restricted to its configured owner' });
    return next();
}

function singleTenantUserId(env = process.env) {
    if (!singleTenantEnabled(env)) return null;
    return configuredOwnerId(env);
}

module.exports = { requireSingleTenant, singleTenantEnabled, singleTenantUserId };

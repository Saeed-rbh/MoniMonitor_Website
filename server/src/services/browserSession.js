function cookieName() { return process.env.NODE_ENV === 'production' ? '__Host-monimonitor' : 'monimonitor_session'; }
function setBrowserSession(req, res, session) {
    const mode = req.get('X-Session-Mode');
    if (mode !== 'cookie') return session;
    res.cookie(cookieName(), session.accessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production' || req.secure,
        sameSite: 'lax', path: '/', maxAge: Math.max(0, session.expiresAt - Date.now()) });
    return { expiresAt: session.expiresAt };
}
function clearBrowserSession(res) {
    res.clearCookie(cookieName(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
}
function requestSession(req, allowedOrigins) {
    const authorization = req.headers.authorization;
    if (authorization?.startsWith('Bearer ')) return { token: authorization.slice(7), forbidden: false };
    const cookies = String(req.headers.cookie || '').split(';').map(value => value.trim());
    const value = cookies.find(cookie => cookie.startsWith(`${cookieName()}=`));
    let token = null;
    try { if (value) token = decodeURIComponent(value.slice(cookieName().length + 1)); } catch { return { token: null }; }
    if ((token || req.get('X-Session-Mode') === 'cookie') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.get('Origin');
        if (!origin || origin === 'null' || !allowedOrigins.includes(origin)) return { token: null, forbidden: true };
    }
    return { token, forbidden: false };
}
module.exports = { setBrowserSession, clearBrowserSession, requestSession };

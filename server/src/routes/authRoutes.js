function registerAuthRoutes(app, {
    authRateLimit,
    requireRegistrationOpen,
    credentialsAreValid,
    dbService,
    crypto,
    bcrypt,
    jwt,
    jwtSecret,
    jwtExpiresIn,
    telegramBotToken,
    telegramUserId,
    telegramAppUserId,
    validateTelegramInitData,
    normalizeTelegramPhotoUrl,
    singleTenantEnabled,
    singleTenantUserId,
}) {
    app.post('/register', authRateLimit, requireRegistrationOpen, async (req, res) => {
        const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
        const { password } = req.body || {};
        if (!credentialsAreValid(username, password)) {
            return res.status(400).json({ error: 'Use a username of 3-64 characters and a password of at least 12 characters' });
        }
        try {
            const existingUser = await dbService.getUserByUsername(username);
            if (existingUser) return res.status(409).json({ error: 'Unable to create account with those credentials' });
            const hashedPassword = await bcrypt.hash(password, 12);
            await dbService.createUser(crypto.randomUUID(), username, hashedPassword);
            return res.status(201).json({ message: 'Account created' });
        } catch (error) {
            console.error('Register error:', error);
            return res.status(500).json({ error: 'Unable to create account' });
        }
    });

    app.post('/login', authRateLimit, async (req, res) => {
        const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
        const { password } = req.body || {};
        if (typeof password !== 'string' || !username) return res.status(401).json({ error: 'Invalid username or password' });
        try {
            const user = await dbService.getUserByUsername(username);
            const valid = user && await bcrypt.compare(password, user.password);
            if (!valid) return res.status(401).json({ error: 'Invalid username or password' });
            if (singleTenantEnabled() && String(user.id) !== String(singleTenantUserId())) {
                return res.status(403).json({ error: 'This installation is restricted to its configured owner' });
            }
            const accessToken = jwt.sign({ userId: user.id, username: user.username }, jwtSecret, { expiresIn: jwtExpiresIn });
            return res.json({
                accessToken,
                user: { id: user.id, username: user.username, profilePhotoUrl: user.profilePhotoUrl || null, joinedAt: user.createdAt || null },
            });
        } catch (error) {
            console.error('Login error:', error);
            return res.status(500).json({ error: 'Unable to sign in' });
        }
    });

    app.post('/telegram-auth', authRateLimit, async (req, res) => {
        if (!telegramBotToken || !telegramUserId || !telegramAppUserId) {
            return res.status(503).json({ error: 'Telegram authentication is not configured' });
        }
        try {
            const telegramUser = validateTelegramInitData(req.body?.initData, telegramBotToken);
            if (String(telegramUser.id) !== String(telegramUserId)) {
                return res.status(403).json({ error: 'This Telegram account is not authorized' });
            }
            const user = await dbService.getUserById(telegramAppUserId);
            if (!user) return res.status(403).json({ error: 'Telegram account is not linked' });
            const profilePhotoUrl = normalizeTelegramPhotoUrl(telegramUser.photo_url);
            await dbService.updateUserProfilePhoto(user.id, profilePhotoUrl);
            const accessToken = jwt.sign(
                { userId: user.id, username: user.username, telegramUserId: String(telegramUser.id) },
                jwtSecret,
                { expiresIn: jwtExpiresIn }
            );
            return res.json({
                accessToken,
                user: { id: user.id, username: user.username, profilePhotoUrl, joinedAt: user.createdAt || null },
            });
        } catch {
            return res.status(401).json({ error: 'Unable to verify Telegram identity' });
        }
    });
}

module.exports = { registerAuthRoutes };

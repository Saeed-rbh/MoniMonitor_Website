const SENSITIVE_KEY = /authorization|cookie|password|secret|token|key|rawpayload|rawbody|imap|credential/i;

function redact(value, key = '') {
    if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
    if (Array.isArray(value)) return value.map((item) => redact(item));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
    }
    if (typeof value === 'string' && value.length > 1000) return `${value.slice(0, 1000)}…[TRUNCATED]`;
    return value;
}

function write(level, event, fields = {}) {
    const entry = redact({ timestamp: new Date().toISOString(), level, event, ...fields });
    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

const logger = {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
};

module.exports = { logger, redact };

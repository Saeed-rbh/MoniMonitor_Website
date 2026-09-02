const dbService = require('../database/dbService');
const telegram = require('./telegramService');
const { reportSubsystem } = require('./subsystemHealth');
const { workersPaused, registerWorker } = require('./workerLifecycle');
const { logger } = require('./logger');

const POLL_INTERVAL_MS = Number(process.env.TELEGRAM_OUTBOX_POLL_INTERVAL_MS || 5_000);
const WORKER_ID = `telegram-outbox-${process.pid}-${Math.random().toString(16).slice(2)}`;

const state = {
    startedAt: null,
    lastSuccessAt: null,
    lastError: null,
    running: false,
    timer: null,
};

async function deliver(job) {
    const payload = job.payload || {};
    switch (job.action) {
        case 'sendMessage':
            return telegram.sendTelegramMessage(
                payload.text,
                payload.replyMarkup || null,
                Boolean(payload.silent),
                payload.protectContent !== false
            );
        case 'deleteMessage':
            return telegram.deleteTelegramMessage(payload.messageId);
        case 'editMessage':
            return telegram.editTelegramMessage(payload.messageId, payload.text, payload.replyMarkup || null);
        default:
            throw new Error(`Unsupported Telegram outbox action: ${job.action}`);
    }
}

async function processTelegramOutboxOnce(limit = 50) {
    const jobs = await dbService.claimTelegramOutbox(WORKER_ID, limit);
    for (const job of jobs) {
        try {
            const result = await deliver(job);
            if (!result?.ok) throw new Error(result?.description || 'Telegram API did not confirm delivery');
            await dbService.completeTelegramOutbox(job.id, WORKER_ID, result?.result?.message_id || null);
            logger.info('telegram_outbox.delivered', { correlationId: `job:telegram:${job.id}`, jobId: job.id, action: job.action });
            state.lastSuccessAt = new Date().toISOString();
            state.lastError = null;
            reportSubsystem('telegramOutbox', { configured: true, state: 'ready', lastSuccessAt: state.lastSuccessAt, lastError: null });
        } catch (error) {
            state.lastError = String(error?.message || error);
            reportSubsystem('telegramOutbox', { configured: true, state: 'degraded', lastError: state.lastError });
            await dbService.failTelegramOutbox(job.id, WORKER_ID, error);
            logger.error('telegram_outbox.delivery_failed', { correlationId: `job:telegram:${job.id}`, jobId: job.id, action: job.action, error: state.lastError });
        }
    }
    return jobs.length;
}

function startTelegramOutboxWorker() {
    if (state.timer) return;
    state.startedAt = new Date().toISOString();
    reportSubsystem('telegramOutbox', { configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID), state: 'starting' });
    const tick = async () => {
        if (workersPaused()) return;
        if (state.running) return;
        state.running = true;
        try {
            await processTelegramOutboxOnce();
        } catch (error) {
            state.lastError = String(error?.message || error);
            reportSubsystem('telegramOutbox', { configured: true, state: 'failed', lastError: state.lastError });
            console.error('[Telegram outbox] Worker failed:', state.lastError);
        } finally {
            state.running = false;
        }
    };
    state.timer = setInterval(tick, POLL_INTERVAL_MS);
    state.timer.unref?.();
    tick();
    registerWorker('telegramOutbox', {
        pause: async () => { if (state.timer) clearInterval(state.timer); state.timer = null; },
        resume: async () => startTelegramOutboxWorker(),
    });
}

function getTelegramOutboxWorkerHealth() {
    return {
        configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        running: Boolean(state.timer),
        startedAt: state.startedAt,
        lastSuccessAt: state.lastSuccessAt,
        lastError: state.lastError,
    };
}

module.exports = { processTelegramOutboxOnce, startTelegramOutboxWorker, getTelegramOutboxWorkerHealth };

// A webhook received during a fetch must trigger a subsequent fetch: the first
// response may predate that webhook. Coalesce bursts into one trailing pass.
function createItemSyncCoordinator(perform, loadLatest) {
    const running = new Map();
    const trailing = new Map();
    const merge = (left, right) => Object.fromEntries(
        [...new Set([...Object.keys(left), ...Object.keys(right)])]
            .map(key => [key, Boolean(left[key] || right[key])])
    );
    function start(item, options) {
        const promise = Promise.resolve().then(() => perform(item, options))
            .finally(() => { if (running.get(item.itemId) === promise) running.delete(item.itemId); });
        running.set(item.itemId, promise);
        return promise;
    }
    function sync(item, options = {}, ensureFresh = false) {
        const queued = trailing.get(item.itemId);
        if (queued) { queued.options = merge(queued.options, options); return queued.promise; }
        const active = running.get(item.itemId);
        if (!active) return start(item, options);
        if (!ensureFresh) return active;
        const request = { options: { ...options } };
        request.promise = active.catch(() => {}).then(async () => {
            try {
                const latest = await loadLatest(item);
                trailing.delete(item.itemId);
                if (!latest) throw new Error('Bank connection no longer exists');
                return start(latest, request.options);
            } catch (error) { trailing.delete(item.itemId); throw error; }
        });
        trailing.set(item.itemId, request);
        return request.promise;
    }
    return { sync, running, trailing };
}
module.exports = { createItemSyncCoordinator };

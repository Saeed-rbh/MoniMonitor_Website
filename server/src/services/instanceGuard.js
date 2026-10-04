const net = require('node:net');

function acquireInstance(port, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
        const guard = net.createServer(socket => socket.destroy());
        guard.once('error', () => reject(new Error('Another backend supervisor is running, or the instance lock port is unavailable')));
        guard.listen(port, host, () => resolve(guard));
    });
}

function assertApiPortFree(port, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ port, host });
        socket.setTimeout(3000);
        socket.once('connect', () => { socket.destroy(); reject(new Error('An API already owns the configured port; refusing a duplicate backend')); });
        socket.once('error', error => { socket.destroy(); error.code === 'ECONNREFUSED' ? resolve() : reject(new Error('Cannot verify API port availability')); });
        socket.once('timeout', () => { socket.destroy(); reject(new Error('API port availability check timed out')); });
    });
}
module.exports = { acquireInstance, assertApiPortFree };

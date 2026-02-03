const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');
const QRCode = require('qrcode');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * RabbitGateway
 * 
 * A clean implementation of the Rabbit R1 OpenClaw gateway protocol.
 */
class RabbitGateway extends EventEmitter {
    /**
     * @param {Object} options
     * @param {number} [options.port=18789] - WebSocket server port
     * @param {string} [options.token] - Hardcoded gateway token (optional, auto-generated if missing)
     * @param {boolean} [options.debug=false] - Enable debug logging
     */
    constructor(options = {}) {
        super();
        this.port = options.port || 18789;
        this.debug = options.debug || false;

        this.wss = null;
        this.token = options.token || uuidv4().replace(/-/g, '');

        this.clients = new Map(); // deviceId -> WebSocket
    }

    /**
     * Start the Gateway Server
     */
    start() {
        this.wss = new WebSocket.Server({ port: this.port });

        this.log(`Rabbit Gateway listening on port ${this.port}`);
        this.log(`Gateway Token: ${this.token}`);

        this.wss.on('connection', (ws, req) => this._handleConnection(ws, req));

        this.wss.on('error', (err) => {
            console.error('Rabbit Gateway Error:', err);
            this.emit('error', err);
        });
    }

    /**
     * Generate QR Code Data URL for pairing
     * @param {boolean} [useTailscale=false] - Attempt to include Tailscale IP
     * @returns {Promise<string>} - Data URL of the QR code image
     */
    async getQrCode(useTailscale = false) {
        const ips = this._getLanIps();

        if (useTailscale) {
            const tsIp = await this._getTailscaleIp();
            if (tsIp && !ips.includes(tsIp)) {
                ips.unshift(tsIp);
            }
        }

        const payload = {
            type: 'clawdbot-gateway',
            version: 1,
            ips: ips,
            port: this.port,
            token: this.token,
            protocol: 'ws'
        };

        return await QRCode.toDataURL(JSON.stringify(payload));
    }

    /**
     * Send text message to a connected device
     * @param {string} deviceId 
     * @param {string} text 
     * @param {Object} [options]
     * @param {string} [options.sessionKey='main']
     * @param {string} [options.runId] - Recommended to link to a request
     */
    sendText(deviceId, text, options = {}) {
        const ws = this.clients.get(deviceId);
        if (!ws) {
            this.log(`Cannot send to ${deviceId}: Not connected`);
            return false;
        }

        const payload = {
            type: 'event',
            event: 'chat',
            payload: {
                runId: options.runId || uuidv4(),
                sessionKey: options.sessionKey || 'main',
                seq: 1,
                state: 'final',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: text }],
                    timestamp: Date.now(),
                    stopReason: 'stop',
                    usage: { input: 0, output: 0, totalTokens: 0 }
                }
            }
        };

        this._sendJson(ws, payload);
        return true;
    }

    // --- Internal Methods ---

    _handleConnection(ws, req) {
        const remoteInfo = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
        this.log(`New connection from ${remoteInfo}`);

        // 1. Send Challenge
        const nonce = uuidv4();
        this._sendJson(ws, {
            type: 'event',
            event: 'connect.challenge',
            payload: { nonce, ts: Date.now() }
        });

        ws.on('message', async (data) => {
            try {
                const msg = JSON.parse(data);
                await this._handleMessage(ws, msg, remoteInfo);
            } catch (err) {
                this.log(`Error parsing message from ${remoteInfo}: ${err.message}`);
            }
        });

        ws.on('close', () => {
            this._handleDisconnect(ws);
        });
    }

    async _handleMessage(ws, msg, remoteInfo) {
        if (this.debug) console.log('IN <', JSON.stringify(msg));

        // Handshake / Connect
        if (msg.method === 'connect' || msg.method === 'gateway.connect') {
            const clientToken = this._extractToken(msg);
            const deviceId = this._extractDeviceId(msg) || `device-${remoteInfo}`;

            if (clientToken !== this.token) {
                this.log(`Auth failed for device ${deviceId}`);
                this._sendJson(ws, { type: 'res', id: msg.id, ok: false, error: { code: 401, message: 'Invalid token' } });
                return;
            }

            // Success
            this.clients.set(deviceId, ws);
            ws.deviceId = deviceId; // tag socket

            this.log(`Device Paired: ${deviceId}`);

            // 1. Pair Approved Event
            this._sendJson(ws, {
                type: 'event',
                event: 'node.pair.approved',
                payload: { deviceId, token: uuidv4() }
            });

            // 2. Response to connect request
            this._sendJson(ws, {
                type: 'res',
                id: msg.id,
                ok: true,
                payload: { status: 'paired', ts: Date.now() }
            });

            // 3. Connect OK Event
            this._sendJson(ws, {
                type: 'event',
                event: 'connect.ok',
                payload: { deviceId, ts: Date.now() }
            });

            this.emit('deviceConnected', { id: deviceId, remote: remoteInfo });
            return;
        }

        // Chat
        if (msg.method === 'chat.send') {
            const deviceId = ws.deviceId || 'unknown';
            const text = msg.params.message;
            this.emit('message', {
                deviceId,
                text,
                sessionKey: msg.params.sessionKey,
                idempotencyKey: msg.params.idempotencyKey
            });

            // Ack
            this._sendJson(ws, { type: 'res', id: msg.id, ok: true });
        }
    }

    _handleDisconnect(ws) {
        if (ws.deviceId) {
            this.clients.delete(ws.deviceId);
            this.log(`Device disconnected: ${ws.deviceId}`);
            this.emit('deviceDisconnected', { id: ws.deviceId });
        }
    }

    _sendJson(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            if (this.debug) console.log('OUT >', JSON.stringify(data));
            ws.send(JSON.stringify(data));
        }
    }

    _extractToken(msg) {
        return (msg.params?.auth?.token || msg.params?.authToken || msg.auth?.token || msg.token);
    }

    _extractDeviceId(msg) {
        return (msg.params?.device?.id || msg.params?.deviceId || msg.params?.client?.id || msg.deviceId);
    }

    _getLanIps() {
        const nets = os.networkInterfaces();
        const results = [];
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    if (net.address.startsWith('192.168.') || net.address.startsWith('10.') || net.address.startsWith('172.')) {
                        results.push(net.address);
                    }
                }
            }
        }
        return results;
    }

    async _getTailscaleIp() {
        const commands = [
            'tailscale ip -4',
            '/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4',
            '/usr/local/bin/tailscale ip -4',
            '/opt/homebrew/bin/tailscale ip -4'
        ];

        for (const cmd of commands) {
            try {
                const { stdout } = await execPromise(cmd);
                if (stdout && stdout.trim()) return stdout.trim();
            } catch (e) { }
        }
        return null;
    }

    log(msg) {
        console.log(`[RabbitGateway] ${msg}`);
    }
}

module.exports = RabbitGateway;

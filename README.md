# Rabbit R1 Library

A standalone, reverse-engineered implementation of the **Rabbit R1 OpenClaw Gateway Protocol**. This library allows you to build custom backends for the Rabbit R1 device without relying on the official servers or complex AI platforms.

## Installation

```bash
npm install rabbit-r1-lib
```

## Quick Start

```javascript
const { RabbitGateway } = require('rabbit-r1-lib');

// Start the gateway
const gateway = new RabbitGateway({ 
    port: 18789,
    debug: true 
});

gateway.start();

// Handle device connections
gateway.on('deviceConnected', (device) => {
    console.log(`R1 Connected: ${device.id}`);
    
    // Send a welcome message
    gateway.sendText(device.id, "Welcome to your custom backend!");
});

// Handle messages from the R1
gateway.on('message', (msg) => {
    console.log(`User said: ${msg.text}`);
    
    // Echo back
    gateway.sendText(msg.deviceId, `You said: ${msg.text}`);
});

// Generate pairing QR Code
gateway.getQrCode().then(url => {
    console.log("Scan this QR code with your R1 camera:", url);
    // Use 'qrcode-terminal' or serve this data URL to a browser
});
```

---

## The Protocol (Reverse Engineered)

The Rabbit R1 communicates via a WebSocket connection using a JSON-RPC-like format.

### 1. Connection & Handshake

1.  **Client connects** to `ws://<SERVER_IP>:18789`.
2.  **Server sends Challenge**: Immediately upon connection.
    ```json
    {
      "type": "event",
      "event": "connect.challenge",
      "payload": { "nonce": "<UUID>", "ts": 1234567890 }
    }
    ```
3.  **Client sends Connect Request**: Includes the gateway token (scanned from QR).
    ```json
    {
      "method": "connect",
      "params": {
        "auth": { "token": "<GATEWAY_TOKEN>" },
        "device": { "id": "<DEVICE_ID>" }
      },
      "id": "<UUID>"
    }
    ```
4.  **Server Validates & Approves**:
    *   Sends `node.pair.approved` event.
    *   Sends response to `connect` request (`ok: true`).
    *   Sends `connect.ok` event.

### 2. Chatting

**User -> Server:**
The device sends spoken text via `chat.send`.
```json
{
  "method": "chat.send",
  "params": {
    "message": "Hello world",
    "sessionKey": "main",
    "idempotencyKey": "<RUN_ID>"
  },
  "id": "<UUID>"
}
```

**Server -> User:**
The server sends responses as `chat` events. This triggers the R1 to speak/display text.
```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "runId": "<RUN_ID>",
    "sessionKey": "main",
    "state": "final",
    "message": {
      "role": "assistant",
      "content": [{ "type": "text", "text": "Hello human!" }]
    }
  }
}
```

## Features

*   **Pure JS**: Minimal dependencies (`ws`, `qrcode`).
*   **Tailscale Support**: Helper method to generate QR codes with Tailscale IPs for remote access.
*   **Event Driven**: Standard Node.js `EventEmitter` interface.

## License

MIT

const { RabbitGateway } = require('../index');

// Initialize Gateway
const gateway = new RabbitGateway({
    port: 18789,
    debug: true // See incoming/outgoing JSON
});

// Start Server
gateway.start();

console.log('--- Rabbit R1 Simple Bot ---');

// Event: Device Connected
gateway.on('deviceConnected', (device) => {
    console.log(`\n>>> Device Connected: ${device.id} (${device.remote})`);

    // Send welcome message
    gateway.sendText(device.id, "Hello! I am a custom Rabbit R1 server.");
});

// Event: Device Disconnected
gateway.on('deviceDisconnected', (device) => {
    console.log(`\n<<< Device Disconnected: ${device.id}`);
});

// Event: Incoming Message (Voice/Text from R1)
gateway.on('message', (msg) => {
    console.log(`\n[${msg.deviceId}] User: ${msg.text}`);

    // Simple logic: Echo back reversed, or time
    let response = "";

    if (msg.text.toLowerCase().includes('time')) {
        response = `The time is ${new Date().toLocaleTimeString()}`;
    } else {
        response = `You said: ${msg.text}`;
    }

    console.log(`[Bot] Replying: ${response}`);
    gateway.sendText(msg.deviceId, response, { runId: msg.idempotencyKey });
});

// Generate QR Code for console (url only)
gateway.getQrCode(false).then(url => {
    console.log('\n--- Usage ---');
    console.log('1. Scan the QR code data below (e.g. paste into a browser bar to see image)');
    console.log('   Data URL length:', url.length);
    console.log('   (Use a proper QR generator with the JSON payload if managing manually)');

    // Printing full data URL might be too long for some consoles, but we can print the helpful start
    console.log(`   URL starts with: ${url.substring(0, 50)}...`);
});

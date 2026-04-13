const config = require('./src/config.js');
const mysql2 = require('mysql2/promise');
const { ScaleBridge } = require('./src/scale-bridge.js');

async function test() {
    try {
        const bridge = new ScaleBridge(config);
        await bridge.ensureSchema();
        const res = await bridge.syncProducts();
        console.log("Sync result:", res);
    } catch(e) {
        console.error("Sync error:", e);
    } finally {
        process.exit(0);
    }
}
test();

const { spawn } = require('child_process');
const path = require('path');

const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
});

child.unref();
console.log(`PID ${child.pid}`);

// pm2 settings for the chat process. Used by deploy/deploy.sh.
// One process only: live calls are held in the server's memory.
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'chat-server',
      script: './server/main.js',
      cwd: path.join(__dirname, '..'),
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
      kill_timeout: 10000,
    },
  ],
};

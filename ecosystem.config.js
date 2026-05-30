module.exports = {
  apps: [
    {
      name: 'nodeA',
      script: 'npm',
      args: 'run start:nodeA',
      instances: 1,
      autorestart: true,
      watch: false,
      env_production: { NODE_ENV: 'production' },
    },
    {
      name: 'nodeB',
      script: 'npm',
      args: 'run start:nodeB',
      instances: 1,
      autorestart: true,
      watch: false,
      env_production: { NODE_ENV: 'production' },
    },
  ],
};

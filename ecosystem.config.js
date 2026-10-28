module.exports = {
  apps: [
    {
      name: 'kabonix-api',
      script: 'apps/api/src/server.js',
      cwd: '/var/www/kabonix-foundation',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--env-file=apps/api/.env',
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'kabonix-portal',
      script: 'apps/web/serve.js',
      cwd: '/var/www/kabonix-foundation',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        API_URL: 'http://15.240.226.191:4000',
        WEBSITE_URL: 'http://15.240.226.191:3001',
      },
    },
    {
      name: 'kabonix-website',
      script: 'apps/website/serve.js',
      cwd: '/var/www/kabonix-foundation',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        API_URL: 'http://15.240.226.191:4000',
        PORTAL_URL: 'http://15.240.226.191:3000',
      },
    },
  ],
};

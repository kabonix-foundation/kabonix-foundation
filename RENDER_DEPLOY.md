# Render Deployment

## Blueprint deployment

Use the included `render.yaml` to create the services.

### API

- Root Directory: `.`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

The root `package.json` must contain the `start` script that launches the API.

### Environment variables

The API receives:

- `DATABASE_URL` from the Render PostgreSQL database.
- `WEB_ORIGIN` set to the public website URL.

### Services

The Blueprint creates:

- `kabonix-api` — Node.js API
- `kabonix-staff` — staff static site
- `kabonix-public` — public static site
- `kabonix-db` — PostgreSQL database

## Existing Render service

If you already created the API manually, make sure:

1. Root Directory is `.`
2. Build Command is `npm install`
3. Start Command is `npm start`
4. `DATABASE_URL` is configured
5. Deploy again after saving the settings

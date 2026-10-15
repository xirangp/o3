# Deployment Guide

## Deploy to Cloudflare Workers

### Direct Deployment

```bash
npm run deploy
```

This command will:
1. Build the application
2. Deploy it to Cloudflare Workers

### Manual Deployment

Build and deploy separately:

```bash
npm run build
wrangler deploy
```

### GitHub Actions Deployment

The repository includes a built-in GitHub Actions workflow (`.github/workflows/deploy.yml`) for automatic deployment.

**Trigger conditions:**
- Push to `main` or `master` branch
- Manual `workflow_dispatch`

**Workflow steps:**
Checkout → Node 20 → `npm ci` → Generate `wrangler.jsonc` → `npm run build` → D1 migrations → `wrangler deploy`

#### Prerequisites

1. Cloudflare account with Workers and D1 enabled
2. D1 database created
3. Cloudflare API Token with Workers and D1 permissions
4. Code pushed to GitHub repository

#### GitHub Secrets

Add the following secrets in "Settings → Secrets and variables → Actions → Secrets":

| Secret | Description | Required |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token | Yes |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID | Yes |
| `ADMIN_USERNAME` | Admin username | Yes |
| `ADMIN_PASSWORD` | Admin password | Yes |
| `WEBDAV_USERNAME` | WebDAV username | No |
| `WEBDAV_PASSWORD` | WebDAV password | No |

#### GitHub Variables

Add variables in "Settings → Secrets and variables → Actions → Variables":

| Variable | Default | Description |
| --- | --- | --- |
| `WORKER_NAME` | `clist` | Worker name |
| `WORKER_MAIN` | `./workers/app.ts` | Worker entry |
| `COMPATIBILITY_DATE` | `2025-04-04` | Workers compatibility date |
| `D1_DATABASE_NAME` | `clist` | D1 database name |
| `D1_DATABASE_ID` | (empty) | Leave empty for auto-lookup |
| `D1_BINDING` | `DB` | D1 binding name |
| `D1_MIGRATIONS_DIR` | `./migrations` | Migrations directory |
| `OBSERVABILITY_ENABLED` | `true` | Observability toggle |
| `SITE_TITLE` | (empty) | Site title |
| `SITE_ANNOUNCEMENT` | (empty) | Site announcement |
| `CHUNK_SIZE_MB` | (empty) | Upload chunk size |
| `WEBDAV_ENABLED` | (empty) | `true` / `false` |

#### Triggering Deployment

1. Push code to `main` or `master` branch for automatic deployment.
2. Go to GitHub Actions, select "Deploy to Cloudflare Workers", and click "Run workflow" for manual trigger.

#### Post-Deployment Checks

1. Verify the script is updated in the Cloudflare Workers dashboard.
2. Visit your domain or the default Workers domain to check the page and API.

# Production Guide

This guide describes one production path:

- source branch: `codex/crypto-production`
- source repository: GitHub
- VPS checkout: `/opt/friendly-goggles`
- runtime: Docker Compose on the VPS
- public domain: `tri.baby`
- deploy trigger: `git push origin codex/crypto-production`

There is no `main` handoff in this setup. The deploy workflow runs from the branch you push, then the VPS fetches and resets to that same branch.

Command context used below:

- `[local]` means run the command on your own machine, from any terminal that can reach GitHub and the VPS.
- `[local repo]` means run the command on your own machine inside this repository checkout.
- `[VPS root]` means run the command after SSH login as `root` on the DigitalOcean VPS.
- `[VPS deploy]` means run the command after SSH login as the `deploy` user on the VPS.
- `[GitHub UI]` means the step is done in the GitHub website.
- `[DNS UI]` means the step is done in your domain/DNS provider website.

## 1. What Goes Where

| Item | Where It Lives | Purpose |
| --- | --- | --- |
| Source code | GitHub branch `codex/crypto-production` | The version to deploy. |
| Production checkout | VPS path `/opt/friendly-goggles` | The repo copy Docker Compose builds and runs. |
| Production bootstrap secrets | VPS file `/opt/friendly-goggles/.env.production` | Database connection, session signing, first admin login, Caddy domain/allowlist. Never commit it. |
| Application settings | App UI, stored in Postgres | Default exchange, public app URL, CoinGecko key, TSFM endpoint/key. |
| Docker services | VPS Docker Engine | `app`, `worker`, `postgres`, and `caddy`. |
| HTTPS entrypoint | `https://tri.baby` | Caddy terminates TLS and proxies allowed traffic to the app. |
| GitHub Actions deploy key | GitHub secret `VPS_SSH_KEY` | Lets Actions SSH into the VPS. |
| VPS GitHub deploy key | GitHub repo deploy key | Lets the VPS pull the private repository. |

## 2. Point `tri.baby` At The VPS

`tri.baby` is configured outside the VPS, in the DNS provider panel.

In the DNS provider website, create this record:

```text
tri.baby -> YOUR_VPS_PUBLIC_IPV4
```

If you use IPv6, also create:

```text
tri.baby -> YOUR_VPS_PUBLIC_IPV6
```

In the DigitalOcean firewall panel, allow inbound:

- `22/tcp` from your admin IP for SSH;
- `80/tcp` and `443/tcp` from the internet for Caddy and TLS.

If you also use `ufw` inside the VPS, configure it as `root` on the VPS:

```bash
ssh root@tri.baby
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
exit
```

If `ufw` is not installed, install it first as `root`:

```bash
apt-get update
apt-get install -y ufw
```

Caddy handles HTTPS certificates automatically. There is no manual certificate installation step. The first `docker compose up` starts Caddy, Caddy answers the ACME HTTP/TLS challenge on ports `80` and `443`, and certificates are stored in the `caddy_data` Docker volume. This only works after DNS points `tri.baby` to the VPS and ports `80/443` are reachable from the internet.

From your local machine, wait until DNS resolves to the VPS:

```bash
dig +short tri.baby
```

## 3. Prepare The VPS User

Log in to the new VPS as `root`:

```bash
ssh root@tri.baby
```

Run these commands as `root` on the VPS:

```bash
apt-get update
apt-get install -y git curl ca-certificates openssl

docker --version
docker compose version
```

Create the `deploy` user and allow it to run Docker:

```bash
id deploy || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
```

Create the deployment directory while you are still `root`, then give it to `deploy`:

```bash
mkdir -p /opt/friendly-goggles
chown deploy:deploy /opt/friendly-goggles
```

Leave the `root` SSH session:

```bash
exit
```

Log in as the `deploy` user. Use this user for the rest of the VPS commands unless a step explicitly says `[VPS root]`.

```bash
ssh deploy@tri.baby
```

Verify that `deploy` can see Docker:

```bash
docker --version
docker compose version
```

## 4. Give The VPS Read Access To GitHub

Run this as `deploy` on the VPS. This key lets the VPS pull the GitHub repository.

```bash
install -d -m 700 ~/.ssh
ssh-keygen -t ed25519 -C "friendly-goggles-vps-github" -f ~/.ssh/friendly_goggles_github
cat ~/.ssh/friendly_goggles_github.pub
```

Copy the full public key printed by the last command. It starts with `ssh-ed25519`.

Add it in GitHub:

1. Open the repository on GitHub.
2. Go to Settings, Deploy keys.
3. Click Add deploy key.
4. Paste the public key.
5. Leave write access disabled.
6. Save.

Back on the VPS as `deploy`, configure SSH to use that key for GitHub:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/friendly_goggles_github
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T git@github.com
```

GitHub should reject shell access but confirm authentication. That is expected.

## 5. Clone The Production Branch On The VPS

Run these commands as `deploy` on the VPS.

Set the GitHub SSH clone URL first. Replace `YOUR_ORG/YOUR_REPO` with the SSH clone path from the GitHub repository Code button:

```bash
REPO_SSH_URL="git@github.com:YOUR_ORG/YOUR_REPO.git"
```

Verify that `deploy` owns the deployment directory, then clone the production branch into it:

```bash
ls -ld /opt/friendly-goggles
git clone --branch codex/crypto-production "$REPO_SSH_URL" /opt/friendly-goggles
cd /opt/friendly-goggles
git branch --show-current
```

The final command must print:

```text
codex/crypto-production
```

## 6. Create `.env.production`

Run these commands as `deploy` on the VPS.

Move into the production checkout:

```bash
cd /opt/friendly-goggles
```

Generate strong secrets:

```bash
SESSION_SECRET_VALUE="$(openssl rand -hex 32)"
POSTGRES_PASSWORD_VALUE="$(openssl rand -hex 24)"
APP_ADMIN_PASSWORD_VALUE="$(openssl rand -hex 24)"
printf 'SESSION_SECRET=%s\nPOSTGRES_PASSWORD=%s\nAPP_ADMIN_PASSWORD=%s\n' "$SESSION_SECRET_VALUE" "$POSTGRES_PASSWORD_VALUE" "$APP_ADMIN_PASSWORD_VALUE"
```

Set the first admin email and allowed IP range. Replace these two values before running the command:

```bash
APP_ADMIN_EMAIL_VALUE="you@example.com"
ALLOWED_IP_RANGES_VALUE="YOUR_PUBLIC_IP/32"
```

Create `/opt/friendly-goggles/.env.production` from those shell variables:

```bash
cat > .env.production <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
APP_BASE_URL=https://tri.baby
DEFAULT_EXCHANGE=binance

APP_ADMIN_EMAIL=${APP_ADMIN_EMAIL_VALUE}
APP_ADMIN_PASSWORD=${APP_ADMIN_PASSWORD_VALUE}
SESSION_SECRET=${SESSION_SECRET_VALUE}

POSTGRES_DB=friendly_goggles
POSTGRES_USER=friendly
POSTGRES_PASSWORD=${POSTGRES_PASSWORD_VALUE}
DATABASE_URL=postgres://friendly:${POSTGRES_PASSWORD_VALUE}@postgres:5432/friendly_goggles

APP_DOMAIN=tri.baby
ALLOWED_IP_RANGES=${ALLOWED_IP_RANGES_VALUE}

COINGECKO_API_KEY=
TSFM_ENDPOINT_URL=
TSFM_API_KEY=
EOF
chmod 600 .env.production
```

`COINGECKO_API_KEY`, `TSFM_ENDPOINT_URL`, `TSFM_API_KEY`, `DEFAULT_EXCHANGE`, and `APP_BASE_URL` are only initial seed values. After the first start, change them from the app UI under Application settings. Do not edit `.env.production` for normal app tuning.

Check the file without printing secret values:

```bash
grep -E '^(NODE_ENV|APP_BASE_URL|APP_ADMIN_EMAIL|APP_DOMAIN|ALLOWED_IP_RANGES)=' .env.production
test "$(stat -c '%a' .env.production)" = "600"
```

Use a narrow `ALLOWED_IP_RANGES` value. For several trusted networks, set `ALLOWED_IP_RANGES_VALUE` to a space-separated list before creating the file, for example `203.0.113.10/32 198.51.100.0/24`.

## 7. First Manual Start

Run the first deployment manually as `deploy` on the VPS. This proves that Docker, Compose, migrations, Caddy, TLS, DNS, and env values are correct before GitHub Actions takes over.

```bash
cd /opt/friendly-goggles
docker compose --env-file .env.production config
docker compose --env-file .env.production build
docker compose --env-file .env.production run --rm app node scripts/migrate.ts
docker compose --env-file .env.production up -d --remove-orphans
docker compose --env-file .env.production ps
curl -fsS http://127.0.0.1:3000/healthz
```

Then open:

```text
https://tri.baby
```

Open it from an IP included in `ALLOWED_IP_RANGES`, then sign in with `APP_ADMIN_EMAIL` and `APP_ADMIN_PASSWORD`.

## 8. Configure App Settings In The UI

Run these steps in the browser after the first login:

1. Open `https://tri.baby`.
2. Sign in with the bootstrap admin email and password from `.env.production`.
3. Scroll to Application settings.
4. Set Default exchange, App base URL, CoinGecko API key, TSFM endpoint URL, and TSFM API key as needed.
5. Click Save settings.
6. Use Admin account to change the admin email or password.

Secrets entered in the UI are stored in Postgres. The browser only receives configured/not configured status for API keys, not the secret value itself.

These settings no longer require opening `.env.production`:

- `DEFAULT_EXCHANGE`
- `APP_BASE_URL`
- `COINGECKO_API_KEY`
- `TSFM_ENDPOINT_URL`
- `TSFM_API_KEY`
- admin email after bootstrap
- admin password after bootstrap

These still require VPS/DNS changes because they affect the container, database, reverse proxy, or network boundary before the app can serve UI:

- `DATABASE_URL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `SESSION_SECRET`
- `APP_DOMAIN`
- `ALLOWED_IP_RANGES`
- Docker ports and volumes

## 9. Give GitHub Actions SSH Access To The VPS

This is a second SSH key. It is different from the VPS-to-GitHub read key.

Run this on your local machine. It creates the key GitHub Actions will use to SSH into the VPS:

```bash
ssh-keygen -t ed25519 -C "friendly-goggles-actions-to-vps" -f ./friendly-goggles_actions_to_vps
```

Copy the public key to the VPS `deploy` user:

```bash
ssh-copy-id -i ./friendly-goggles_actions_to_vps.pub deploy@tri.baby
```

If `ssh-copy-id` is unavailable, run this local command instead:

```bash
cat ./friendly-goggles_actions_to_vps.pub | ssh deploy@tri.baby "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"
```

On PowerShell, use this local command:

```powershell
Get-Content .\friendly-goggles_actions_to_vps.pub | ssh deploy@tri.baby "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"
```

Still on your local machine, capture the VPS host key:

```bash
ssh-keyscan -H tri.baby
```

Keep the full output. GitHub Actions uses it as `VPS_SSH_HOST_KEY`.

## 10. Configure GitHub Actions Secrets

Prepare the secret values from your local machine:

```bash
cat ./friendly-goggles_actions_to_vps
ssh-keyscan -H tri.baby
```

Then add secrets in GitHub:

1. Open the repository on GitHub.
2. Go to Settings, Environments.
3. Create or open the `production` environment.
4. Add the secrets listed below under Environment secrets.

Use these values:

```text
VPS_HOST=tri.baby
VPS_USER=deploy
VPS_SSH_KEY=<private key content from friendly-goggles_actions_to_vps>
VPS_SSH_HOST_KEY=<full ssh-keyscan -H tri.baby output>
VPS_PATH=/opt/friendly-goggles
```

Recommended environment protection:

1. Restrict deployments to `codex/crypto-production`.
2. Require manual approval if you want a human gate before GitHub can access production secrets.
3. Keep repository Actions permissions read-only by default.

Recommended branch protection:

1. Protect `codex/crypto-production`.
2. Require CI before accepting changes into that branch if you use pull requests.
3. Require review for migrations, deployment, auth, provider, or trading-simulation changes.

## 11. Normal Deployment Flow

Run these commands on your local machine inside the repository checkout.

Check that you are on the production branch:

```bash
git branch --show-current
```

It should print:

```text
codex/crypto-production
```

Deploy by pushing that branch:

```bash
git push origin codex/crypto-production
```

GitHub Actions then does this:

1. Checks out the pushed commit.
2. Runs lint, tests, production build, production dependency audit, Compose config, and Docker image builds.
3. SSHes into `deploy@tri.baby`.
4. Goes to `/opt/friendly-goggles`.
5. Fetches `origin/codex/crypto-production`.
6. Resets the VPS checkout to `origin/codex/crypto-production`.
7. Builds Docker images.
8. Runs migrations.
9. Restarts the Compose stack.
10. Checks `/healthz` inside the app container.

If deployment fails after the VPS had a previous working commit, the workflow resets the VPS checkout to that previous commit and rebuilds the previous app image. Database migrations are forward-only, so take a database backup before risky schema changes.

## 12. Operations

Run operations commands as `deploy` on the VPS:

```bash
cd /opt/friendly-goggles
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f app
docker compose --env-file .env.production logs -f worker
docker compose --env-file .env.production exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql
docker compose --env-file .env.production up -d --remove-orphans
```

To change the network allowlist, run this as `deploy` on the VPS. This one remains in `.env.production` because Caddy reads it before requests reach the app:

```bash
cd /opt/friendly-goggles
NEW_ALLOWED_IP_RANGES="203.0.113.10/32"
sed -i "s|^ALLOWED_IP_RANGES=.*|ALLOWED_IP_RANGES=${NEW_ALLOWED_IP_RANGES}|" .env.production
docker compose --env-file .env.production up -d --remove-orphans
curl -fsS http://127.0.0.1:3000/healthz
```

Change the admin email/password from the app UI under Admin account. Change CoinGecko and TSFM provider values from Application settings.

Before any manual restart, verify health:

```bash
docker compose --env-file .env.production up -d --remove-orphans
curl -fsS http://127.0.0.1:3000/healthz
```

## 13. Optional Providers

CoinGecko:

- Configure the CoinGecko API key in Application settings.
- The key is optional. Without it, the app still works, but public rate limits may apply.

Custom TSFM:

- Configure the TSFM endpoint URL in Application settings.
- Configure the TSFM API key there only if that endpoint expects a bearer token.
- If the TSFM API key is set, the TSFM endpoint URL must also be set.

Worker:

- The Python worker trains lightweight local CPU baselines from stored OHLCV data.
- Artifacts are stored in the `model_artifacts` Docker volume.
- Tune `WORKER_INTERVAL_SECONDS` in `compose.yml` if you want more or less frequent runs.

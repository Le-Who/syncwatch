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

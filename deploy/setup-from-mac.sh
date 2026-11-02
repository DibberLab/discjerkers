#!/usr/bin/env bash
# One-time auto-deploy setup for discjerkers.com. Run on Andrew's Mac, from a
# clone of DibberLab/discjerkers, AFTER the auto-deploy commit is on main:
#
#   bash deploy/setup-from-mac.sh
#
# Needs: the ssh alias dibberlab-droplet, and gh logged in with admin on the repo.
set -euo pipefail

R=DibberLab/discjerkers
APP=/var/www/discjerkers
KEY=~/.ssh/discjerkers-gh-deploy
H=$(ssh -G dibberlab-droplet | awk '/^hostname /{print $2}')   # never hard-code the IP
d() { ssh dibberlab-droplet "$@"; }

echo "== 1. connection ($H)"
d 'hostname && uptime'

echo "== 2. backup of $APP (code, .env and data) before anything else"
d "mkdir -p /root/backups && tar -czf /root/backups/discjerkers-\$(date +%Y%m%d-%H%M%S).tgz -C /var/www discjerkers && ls -lh /root/backups | tail -3"

echo "== 3. make $APP a git checkout of main (keeps .env and data/)"
if d "test -d $APP/.git"; then
    d "cd $APP && git pull --ff-only origin main && git log -1 --oneline"
else
    d "cd $APP && git init -q && git remote add origin https://github.com/$R.git && git fetch -q --depth 1 origin main && git reset -q origin/main && git branch -M main && git branch -u origin/main"
    echo "Files on the server that differ from main (drift from the old rsync deploys):"
    d "cd $APP && git status --short"
    echo
    echo "Tracked files listed above will be replaced with main's version. Untracked ones"
    echo "(.env, data/, node_modules/) are left alone. The backup from step 2 has everything."
    read -r -p "Replace the tracked files with main's version now? [y/N] " ok
    [ "$ok" = "y" ] || { echo "Stopped. Nothing replaced; re-run when ready."; exit 1; }
    d "cd $APP && git checkout -- . && git status --short"
fi

echo "== 4. install the deploy script outside the repo, then run it once"
d "install -m 755 $APP/deploy/discjerkers-deploy.sh /usr/local/bin/discjerkers-deploy && /usr/local/bin/discjerkers-deploy"

echo "== 5. GitHub deploy key, locked to that script"
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -C "github-actions-discjerkers-deploy" -f "$KEY"
PUB=$(cat "$KEY.pub")
d "grep -qF '$PUB' /root/.ssh/authorized_keys || echo 'command=\"/usr/local/bin/discjerkers-deploy\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $PUB' >> /root/.ssh/authorized_keys"

echo "== 6. repository secrets"
gh secret set DEPLOY_HOST -R "$R" -b "$H"
gh secret set DEPLOY_SSH_KEY -R "$R" < "$KEY"
ssh-keyscan -t ed25519 "$H" 2>/dev/null | gh secret set DEPLOY_KNOWN_HOSTS -R "$R"

echo "== 7. test run"
gh workflow run Deploy -R "$R"
sleep 5
gh run watch -R "$R" "$(gh run list -R "$R" -w Deploy -L 1 --json databaseId -q '.[0].databaseId')" --exit-status

echo
echo "Done. Every push to main now deploys discjerkers.com."
echo "GitHub has its copy of the key; you can now: rm $KEY"

#!/usr/bin/env bash
# Server-side deploy for discjerkers.com.
#
# GitHub Actions runs this over SSH after every push to main. The deploy key in
# /root/.ssh/authorized_keys is locked to this one script.
#
# Install (once, on the droplet):
#   install -m 755 /var/www/discjerkers/deploy/discjerkers-deploy.sh /usr/local/bin/discjerkers-deploy
#
# The installed copy lives outside the repo on purpose: a push to main can't
# change what root runs here. Re-run the install line if you edit this file.
set -euo pipefail

APP_DIR=/var/www/discjerkers
cd "$APP_DIR"
[ -d .git ] || { echo "!!! $APP_DIR is not a git checkout; run deploy/setup-from-mac.sh first"; exit 1; }

before=$(git rev-parse HEAD)
git pull --ff-only origin main
after=$(git rev-parse HEAD)
echo ">>> $before -> $after"

if ! git diff --quiet "$before" "$after" -- deploy/discjerkers.nginx.conf; then
    echo "!!! deploy/discjerkers.nginx.conf changed. Install it by hand (nginx -t first)."
fi

# Builds the new image first; the old container keeps serving if the build fails.
docker compose up -d --build

for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3040/healthz >/dev/null 2>&1; then
        echo ">>> discjerkers is up at $(git log -1 --format='%h %s')"
        docker image prune -f >/dev/null 2>&1 || true
        exit 0
    fi
    sleep 2
done
echo "!!! discjerkers did not answer /healthz. Recent logs:"
docker compose logs --tail 60 discjerkers || true
exit 1

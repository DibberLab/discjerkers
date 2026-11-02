# Auto-deploy setup (one time)

Run this from Andrew's Mac (Claude Code CLI or desktop app): the droplet key only lives
there. Use single commands over the `dibberlab-droplet` alias, don't edit files on the server,
and confirm each step that touches GitHub or the server with Andrew first.

What it does: every push to `main` runs the tests, then SSHes in with a key that can only run
`/usr/local/bin/discjerkers-deploy` (pull `main`, `docker compose up -d --build`, wait for
`/healthz`). `.env`, `data/` and nginx are never touched. Same pattern as DibberLab/budget.

1. **Is the app folder a git checkout?**

   ```bash
   ssh dibberlab-droplet 'cd /var/www/discjerkers && git status -sb'
   ```

   If it says "not a git repository" (it was first installed with rsync), make it one without
   changing any files, then look at what differs:

   ```bash
   ssh dibberlab-droplet 'cd /var/www/discjerkers && git init -b main && git remote add origin https://github.com/DibberLab/discjerkers.git && git fetch origin main && git reset origin/main && git status --short'
   ```

   `??` lines (`.env`, `data/`, `shirts/`) are fine. Any `M` line is a hand edit on the server
   that the next step would overwrite: show it to Andrew (`git diff <file>`) before going on.

2. **Merge** the auto-deploy branch into `main` (PR or fast-forward, Andrew's choice). The first
   Actions run fails because the secrets aren't set yet. That's expected and harmless.

3. **Update the server and install the script:**

   ```bash
   ssh dibberlab-droplet 'cd /var/www/discjerkers && git fetch origin main && git reset --hard origin/main && install -m 755 deploy/discjerkers-deploy /usr/local/bin/discjerkers-deploy'
   ```

4. **Make the deploy key** (on the Mac):

   ```bash
   ssh-keygen -t ed25519 -N "" -C "github-actions-discjerkers-deploy" -f ~/.ssh/discjerkers-gh-deploy
   ```

5. **Authorize it so it can only run the deploy script:**

   ```bash
   ssh dibberlab-droplet "echo 'command=\"/usr/local/bin/discjerkers-deploy\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $(cat ~/.ssh/discjerkers-gh-deploy.pub)' >> /root/.ssh/authorized_keys"
   ```

6. **Secrets** (needs `gh` logged in with admin on DibberLab/discjerkers):

   ```bash
   gh secret set DEPLOY_HOST -R DibberLab/discjerkers -b 209.97.148.9
   gh secret set DEPLOY_SSH_KEY -R DibberLab/discjerkers < ~/.ssh/discjerkers-gh-deploy
   ssh-keyscan -t ed25519 209.97.148.9 | gh secret set DEPLOY_KNOWN_HOSTS -R DibberLab/discjerkers
   ```

7. **Test:** `gh workflow run Deploy -R DibberLab/discjerkers`, then
   `gh run watch -R DibberLab/discjerkers`. When it passes, delete `~/.ssh/discjerkers-gh-deploy`
   from the Mac.

After this, deploying is just pushing to `main`. If `deploy/discjerkers-deploy` ever changes,
re-run step 3: the server runs its installed copy, not the repo's, so a push can't change what
root runs.

If a run fails: "Host key verification failed" means re-run the `ssh-keyscan` line;
"Permission denied (publickey)" means step 5 didn't land; "not healthy after 60s" means the
container didn't come back (the run log shows its last output).

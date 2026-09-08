# Vercel deployment

- Project: `client_turn`, connected to `Blackwellen/ClientTurn` (`main`).
- Production URL: https://clientturn.com (also available at https://www.clientturn.com and https://clientturn.vercel.app)
- Production variables are stored in Vercel. Local `.env*` files remain ignored.
- Billing uses Stripe test mode. Its webhook is `/api/webhooks/stripe`, with
  `STRIPE_WEBHOOK_SECRET_CLIENTTURN` configured for this endpoint.
- Supabase Auth uses the production URL and allows both production and localhost
  redirects.

## Background processing is disabled

The owner requested deployment on Vercel Hobby with background processing disabled
on 2026-09-05. `vercel.json` therefore has no cron schedules. Queued follow-ups,
reactivation work, and scheduled maintenance will not run automatically.

After moving to a scheduler that supports every-minute execution, restore:

```json
{
  "crons": [
    { "path": "/api/cron/worker", "schedule": "* * * * *" },
    { "path": "/api/cron/daily", "schedule": "0 2 * * *" }
  ]
}
```

Provider credentials alone do not complete provider setup. See
[INTEGRATION_SETUP.md](INTEGRATION_SETUP.md) for outstanding sender-number,
storage-bucket, and OAuth prerequisites.

## Pushing from a non-interactive shell

`git push` can hang forever with no output while `git ls-remote` works fine.
It is not a network or token problem.

The system config at `C:/Program Files/Git/etc/gitconfig` sets
`credential.helper = manager`, and Git Credential Manager runs *before* the
user-level `store` helper. GCM opens a GUI prompt, which nothing can answer in
an automated shell, so the push blocks indefinitely. `ls-remote` is unaffected
because the read path is already authenticated.

Bypass GCM and use the stored credential:

```bash
git -c credential.helper= -c credential.helper=store push origin main
```

The empty value resets the inherited chain; `store` then reads
`~/.git-credentials`.

Two things that look like the cause and are not:

* **Piping the push.** `git push … | tail -3` reports `tail`'s exit code, so a
  hung or failed push still looks like exit 0.
* **Pushing the wrong ref.** `git push origin main` pushes the *local* `main`
  ref, not `HEAD`. If the working tree is on a feature branch, local `main` may
  already match the remote — the push then correctly does nothing and prints
  nothing, which reads identically to a hang. Check `git branch --show-current`
  before concluding anything.

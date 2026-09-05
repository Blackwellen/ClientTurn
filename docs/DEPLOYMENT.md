# Vercel deployment

- Project: `client_turn`, connected to `Blackwellen/ClientTurn` (`main`).
- Production URL: https://clientturn.vercel.app
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

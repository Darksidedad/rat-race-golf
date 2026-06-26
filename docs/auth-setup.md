# Auth Setup

Rat Race Golf uses Supabase Auth for email/password, password reset, and social login.

## Password Reset

The app sends reset links back to:

```text
https://rat-race-golf.vercel.app/?type=recovery
```

In Supabase, confirm that the production site URL and redirect URL are allowed:

```text
https://rat-race-golf.vercel.app
https://rat-race-golf.vercel.app/**
```

## Social Login

The sign-in screen has buttons for:

- Google
- Apple
- Facebook

Each provider also needs to be enabled in Supabase under Authentication > Providers. Supabase will show the callback URL to paste into each provider's developer console. The app code is ready once the provider client IDs/secrets are configured in Supabase.

Use the production URL as the allowed redirect URL:

```text
https://rat-race-golf.vercel.app/**
```

## Automatic Leaderboard Refresh

The app includes `/api/leaderboard-refresh` for server-side leaderboard updates. Native Vercel cron is not currently configured because the project deployment rejected the frequent cron schedule.

To refresh every few minutes while players are on course, either configure Vercel cron on a plan/settings combination that supports the desired schedule, or call `/api/leaderboard-refresh` from an external scheduler.

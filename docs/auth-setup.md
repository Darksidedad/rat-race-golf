# Auth Setup

Rat Race Golf uses Supabase Auth for email/password, password reset, and social login.

## Password Reset

The app sends reset links back to:

```text
https://www.ratracegolf.com/?type=recovery
```

In Supabase, confirm that the production site URL and redirect URL are allowed:

```text
https://www.ratracegolf.com
https://www.ratracegolf.com/**
https://ratracegolf.com
https://ratracegolf.com/**
```

Keep the Vercel URL as an allowed fallback redirect while the domain migration is fresh:

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
https://www.ratracegolf.com/**
```

## Automatic Leaderboard Refresh

The app includes `/api/leaderboard-refresh` for server-side leaderboard updates. Vercel cron invokes it every five minutes. The refresh route deduplicates requests for leagues using the same event and ignores sessions that have not been active within seven days, keeping Data Golf usage well below its published rate limit.

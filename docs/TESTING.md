# MediaBot v7 test mode

This repository uses **synthetic fixtures** for development and smoke tests. No public/shared API keys or third-party login credentials should be copied into the project.

## Test layers

1. Static smoke checks: `npm test` verifies required entry files, key API route declarations, auth boundaries, and that demo fixtures are clearly marked as synthetic.
2. Production build: `npm run build`.
3. Local integration: use a dedicated local Supabase stack and test-only credentials. Do not point destructive migration/reset commands at production.
4. Provider integration: AI, Douyin, Xiaohongshu, and other providers must be tested with provider-issued sandbox/test credentials or a user's own authorized development app. If those are not available, verify only request validation, error handling, and mocked provider responses.

## Synthetic demo data

`tests/fixtures/demo-data.json` contains fictional accounts, posts, topics, assets, and analytics for UI testing. These records do not represent actual platform metrics and must not be used as real analytics or rankings.

## Secrets

- Never commit `.env`, access tokens, refresh tokens, OAuth client secrets, or service-role keys.
- `.env.test.example` contains placeholders only.
- Use a separate local/staging Supabase project for integration tests.
- Keep the Supabase service-role/secret key on the server only; never prefix it with `VITE_`.

## Before a release

- Run `npm test` and `npm run build`.
- Test sign-in/session expiry and per-user data isolation.
- Test content CRUD and scheduling with a dedicated test account.
- Test storage upload failures and oversized files.
- Verify OAuth state expiry/replay handling.
- Test external publishing only with authorized test accounts and non-public/draft content first.
- Do not mark platform publishing as successful until the provider confirms it.

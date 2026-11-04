# Hub setup

## Auth setup

- Supabase Auth has the GitHub provider turned on (a GitHub OAuth app owned by masonbair).
- Allowed redirect URLs: `https://masonbair.com/hub/auth/callback`, the Vercel preview wildcard for `/hub/auth/callback`, and `masonbair-collector://auth/callback` for the mobile app.
- Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `HUB_OWNER_GITHUB_ID` (`77211262`, from `gh api users/masonbair --jq .id`).
- The first GitHub sign-in whose id matches `HUB_OWNER_GITHUB_ID` adds that user to `hub_owner`. Anyone else who signs in gets a 404 on every `/hub` page and no rows from the database.
- Without `HUB_OWNER_GITHUB_ID`, nobody gets in (the gate fails closed).

# Schema tests

The migration is exercised against a real PostgreSQL before it is trusted —
the permission model is the one part of this build where "looks right" is
worth nothing.

`00-supabase-stub.sql` stands in for the parts of a Supabase project the
migration depends on: the `auth` schema and `auth.users`, the `auth.uid()`
and `auth.role()` helpers (reading a session GUC so a test can become a given
account), the `anon` / `authenticated` / `service_role` roles, and the
`extensions` schema. None of it ships.

`01-schema.test.sql` then checks, in order:

1. **Provisioning** — creating an auth user creates a profile, preferences and
   an activity row, deriving a unique handle and resolving collisions.
2. **Constraints** — malformed handles, non-http websites and absolute
   `item_href` values are rejected.
3. **Read isolation** — an account sees its own saved items and preferences
   and nobody else's.
4. **Write isolation** — cross-account inserts are denied, and cross-account
   updates and deletes match no rows.
5. **Column guard** — an account cannot promote itself to `admin`, while its
   own editable fields still save.
6. **Profile visibility** — a private profile is invisible to anonymous
   readers; preferences and saved items always are.
7. **Activity visibility** — hidden for an account that opted out, readable
   for a public account that did not.
8. **Handle availability** — returns only a boolean, and is case-insensitive.
9. **Cascade** — deleting the auth user leaves nothing behind.
10. **Coverage** — every table has row level security on.

## Running them

Any PostgreSQL 14+ will do.

```bash
createdb makztest
psql -d makztest -v ON_ERROR_STOP=1 -f supabase/tests/00-supabase-stub.sql
psql -d makztest -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
psql -d makztest -c "grant select, insert, update, delete on all tables in schema public to anon, authenticated;"
psql -d makztest -f supabase/tests/01-schema.test.sql
```

Every line of output should read as an `ok:` notice or a count matching the
description beside it. A `FAIL:` exception means the permission model has
regressed.

Two bugs were found this way and are fixed in the migration: an activity
policy that read the private `preferences` table (so no account could ever
see another's public activity), and a `username_available()` search path that
excluded `extensions`, silently degrading the `citext` comparison to a
case-sensitive text match.

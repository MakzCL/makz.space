# SEND

## Writing rules
- Never use long dashes (em dash or en dash) anywhere: UI text, website, docs, commit messages or chat. Use a colon, comma, full stop or "to" instead. A plain hyphen inside a word is fine.

## Deploy notes
- Production does not run migrations when the backend starts. Apply each new `server/migrations/NNN_*.sql` to Supabase (schema `syndo`) by hand and record it in `syndo.schema_migrations`.
- Every new table needs `grant select, insert, update, delete on <table> to syndo_runtime` (the backend's role), wrapped in the `if exists (select 1 from pg_roles where rolname = 'syndo_runtime')` block.

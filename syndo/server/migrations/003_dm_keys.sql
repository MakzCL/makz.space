-- Private API-only directory: public keys only. Secret keys never leave clients.
create table dm_identity_keys (
  user_id bigint primary key references users(id) on delete cascade,
  public_key text not null check(public_key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

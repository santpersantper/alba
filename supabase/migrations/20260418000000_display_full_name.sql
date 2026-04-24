alter table profiles
  add column if not exists display_full_name boolean not null default false;

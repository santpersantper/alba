alter table profiles
  add column if not exists is_organization boolean not null default false;

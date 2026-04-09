-- =============================================================================
-- Imprimir - Supabase Backend Tables
-- Ejecutar este SQL en el SQL Editor de tu nuevo proyecto Supabase
-- =============================================================================

-- Extension para generar UUIDs
create extension if not exists pgcrypto;

-- Funcion utilitaria: actualizar updated_at automaticamente
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- Tabla principal: conexiones Gmail (almacena tokens OAuth)
create table if not exists public.gmail_connections (
  session_id text primary key,
  email text not null,
  google_user_id text,
  access_token text,
  refresh_token text not null,
  scope text,
  token_type text,
  access_token_expires_at timestamptz,
  display_name text,
  picture_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Tabla de estados OAuth (CSRF protection)
create table if not exists public.gmail_oauth_states (
  state text primary key,
  session_id text not null,
  redirect_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

-- Indices para consultas frecuentes
create index if not exists gmail_oauth_states_session_idx on public.gmail_oauth_states (session_id);
create index if not exists gmail_oauth_states_expires_idx on public.gmail_oauth_states (expires_at);

-- Trigger para actualizar updated_at
drop trigger if exists gmail_connections_set_updated_at on public.gmail_connections;
create trigger gmail_connections_set_updated_at
before update on public.gmail_connections
for each row
execute function public.set_updated_at();

-- Row Level Security (las Edge Functions usan service_role_key, asi que no necesitan policies)
alter table public.gmail_connections enable row level security;
alter table public.gmail_oauth_states enable row level security;

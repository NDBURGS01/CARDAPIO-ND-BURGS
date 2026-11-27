-- ND BURGS GESTÃO — banco inicial compartilhado com a loja pública.
create extension if not exists pgcrypto;

create type public.nd_role as enum ('admin','attendant','stock','driver');
create type public.nd_order_status as enum ('received','preparing','ready','out_for_delivery','delivered','cancelled');

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null default '',
 role public.nd_role not null default 'attendant',
 active boolean not null default true,
 created_at timestamptz not null default now()
);

create table if not exists public.orders (
 id uuid primary key default gen_random_uuid(),
 order_number bigserial,
 source text not null default 'site',
 customer_name text not null,
 phone text,
 address text,
 street_name text,
 street_number text,
 region text,
 complement text,
 delivery_type text not null default 'ENTREGA',
 delivery_fee numeric(10,2) not null default 0 check(delivery_fee>=0),
 subtotal numeric(10,2) not null default 0,
 total numeric(10,2) not null default 0,
 payment_method text,
 change_for numeric(10,2),
 notes text,
 status public.nd_order_status not null default 'received',
 driver_id uuid references public.profiles(id),
 shift_id uuid,
 received_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.order_items (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete cascade,
 product_name text not null,
 quantity numeric(10,2) not null default 1,
 unit_price numeric(10,2) not null default 0,
 notes text,
 created_at timestamptz not null default now()
);
create table if not exists public.delivery_fees (
 id uuid primary key default gen_random_uuid(),
 street_name text not null unique,
 region text,
 fee numeric(10,2) not null default 0 check(fee>=0),
 active boolean not null default true,
 updated_at timestamptz not null default now()
);
create table if not exists public.driver_locations (
 driver_id uuid primary key references public.profiles(id) on delete cascade,
 latitude double precision not null,
 longitude double precision not null,
 accuracy_m double precision,
 updated_at timestamptz not null default now()
);
create table if not exists public.inventory_items (
 id uuid primary key default gen_random_uuid(),
 name text not null unique,
 quantity integer not null default 0 check(quantity between 0 and 100),
 unit text not null default 'un',
 updated_at timestamptz not null default now()
);
create table if not exists public.stock_movements (
 id uuid primary key default gen_random_uuid(),
 item_id uuid references public.inventory_items(id),
 user_id uuid references public.profiles(id),
 delta integer not null,
 reason text,
 created_at timestamptz not null default now()
);
create table if not exists public.work_shifts (
 id uuid primary key default gen_random_uuid(),
 opened_by uuid references public.profiles(id),
 opened_at timestamptz not null default now(),
 closed_by uuid references public.profiles(id),
 closed_at timestamptz,
 status text not null default 'open' check(status in ('open','closed')),
 notes text
);
alter table public.orders drop constraint if exists orders_shift_id_fkey;
alter table public.orders add constraint orders_shift_id_fkey foreign key(shift_id) references public.work_shifts(id);
create table if not exists public.cash_movements (
 id uuid primary key default gen_random_uuid(),
 shift_id uuid references public.work_shifts(id),
 user_id uuid references public.profiles(id),
 movement_type text not null check(movement_type in ('expense','withdrawal','addition')),
 amount numeric(10,2) not null check(amount>0),
 payment_method text,
 description text,
 created_at timestamptz not null default now()
);
create table if not exists public.payment_confirmations (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete cascade,
 confirmed_by uuid references public.profiles(id),
 payment_method text not null,
 received boolean not null default false,
 card_receipt_delivered boolean not null default false,
 confirmed_at timestamptz
);
create table if not exists public.routes (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 driver_id uuid references public.profiles(id),
 status text not null default 'open',
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create table if not exists public.route_orders (
 route_id uuid references public.routes(id) on delete cascade,
 order_id uuid references public.orders(id) on delete cascade,
 stop_order integer not null default 0,
 primary key(route_id,order_id)
);
create table if not exists public.audit_logs (
 id bigserial primary key,
 user_id uuid,
 action text not null,
 entity text,
 entity_id text,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create or replace function public.current_nd_role()
returns public.nd_role language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() and active=true $$;
create or replace function public.is_nd_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.current_nd_role()='admin',false) $$;

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.delivery_fees enable row level security;
alter table public.driver_locations enable row level security;
alter table public.inventory_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.work_shifts enable row level security;
alter table public.cash_movements enable row level security;
alter table public.payment_confirmations enable row level security;
alter table public.routes enable row level security;
alter table public.route_orders enable row level security;
alter table public.audit_logs enable row level security;

-- Perfis: cada usuário vê seu próprio perfil; ADMIN vê e gerencia todos.
create policy "profile self or admin read" on public.profiles for select to authenticated using(id=auth.uid() or public.is_nd_admin());
create policy "admin manage profiles" on public.profiles for all to authenticated using(public.is_nd_admin()) with check(public.is_nd_admin());

-- Pedidos: equipe autenticada pode visualizar; ADMIN/ATENDIMENTO gerenciam; motoboy altera somente status/atribuição via função segura no próximo incremento.
create policy "team read orders" on public.orders for select to authenticated using(public.current_nd_role() is not null);
create policy "admin attendant manage orders" on public.orders for all to authenticated using(public.current_nd_role() in ('admin','attendant')) with check(public.current_nd_role() in ('admin','attendant'));
create policy "team read order items" on public.order_items for select to authenticated using(public.current_nd_role() is not null);
create policy "admin attendant manage order items" on public.order_items for all to authenticated using(public.current_nd_role() in ('admin','attendant')) with check(public.current_nd_role() in ('admin','attendant'));

-- Taxas públicas apenas leitura para checkout; escrita restrita.
create policy "public read active fees" on public.delivery_fees for select to anon,authenticated using(active=true);
create policy "admin attendant manage fees" on public.delivery_fees for all to authenticated using(public.current_nd_role() in ('admin','attendant')) with check(public.current_nd_role() in ('admin','attendant'));

create policy "team read driver locations" on public.driver_locations for select to authenticated using(public.current_nd_role() is not null);
create policy "driver upsert own location" on public.driver_locations for all to authenticated using(driver_id=auth.uid() and public.current_nd_role()='driver') with check(driver_id=auth.uid() and public.current_nd_role()='driver');

create policy "team read inventory" on public.inventory_items for select to authenticated using(public.current_nd_role() is not null);
create policy "admin stock manage inventory" on public.inventory_items for all to authenticated using(public.current_nd_role() in ('admin','stock')) with check(public.current_nd_role() in ('admin','stock'));
create policy "team read stock movements" on public.stock_movements for select to authenticated using(public.current_nd_role() is not null);
create policy "admin stock add movement" on public.stock_movements for insert to authenticated with check(public.current_nd_role() in ('admin','stock') and user_id=auth.uid());

create policy "admin manage shifts" on public.work_shifts for all to authenticated using(public.is_nd_admin()) with check(public.is_nd_admin());
create policy "admin manage cash movements" on public.cash_movements for all to authenticated using(public.is_nd_admin()) with check(public.is_nd_admin());
create policy "team read payment confirmations" on public.payment_confirmations for select to authenticated using(public.current_nd_role() is not null);
create policy "admin attendant manage payment confirmations" on public.payment_confirmations for all to authenticated using(public.current_nd_role() in ('admin','attendant')) with check(public.current_nd_role() in ('admin','attendant'));
create policy "team read routes" on public.routes for select to authenticated using(public.current_nd_role() is not null);
create policy "admin attendant manage routes" on public.routes for all to authenticated using(public.current_nd_role() in ('admin','attendant')) with check(public.current_nd_role() in ('admin','attendant'));
create policy "team read route orders" on public.route_orders for select to authenticated using(public.current_nd_role() is not null);
create policy "admin attendant manage route orders" on public.route_orders for all to authenticated using(public.current_nd_role() in ('admin','attendant')) with check(public.current_nd_role() in ('admin','attendant'));
create policy "admin read audit" on public.audit_logs for select to authenticated using(public.is_nd_admin());
create policy "authenticated create audit" on public.audit_logs for insert to authenticated with check(user_id=auth.uid());

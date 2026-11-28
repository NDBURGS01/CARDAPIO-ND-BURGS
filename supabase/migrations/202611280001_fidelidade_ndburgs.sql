-- ND BURGS | Banco central do programa de fidelidade
create extension if not exists pgcrypto;

create table if not exists public.game_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text unique,
  display_name text not null default 'Chef ND',
  points integer not null default 0 check (points >= 0),
  xp integer not null default 0 check (xp >= 0),
  level integer not null default 1 check (level >= 1),
  best_score integer not null default 0 check (best_score >= 0),
  games_played integer not null default 0 check (games_played >= 0),
  role text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score integer,
  caught integer,
  points_awarded integer not null default 0,
  status text not null default 'started' check (status in ('started','finished','rejected')),
  created_at timestamptz not null default now()
);
create index if not exists game_sessions_user_date_idx on public.game_sessions(user_id, created_at desc);

create table if not exists public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  kind text not null check (kind in ('game','mission','redemption','admin_adjustment')),
  description text not null,
  reference_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists points_ledger_user_date_idx on public.points_ledger(user_id, created_at desc);

create table if not exists public.loyalty_coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null unique,
  discount_percent integer not null check (discount_percent in (2,5,7,10)),
  points_cost integer not null,
  status text not null default 'available' check (status in ('available','used','expired','cancelled')),
  expires_at timestamptz not null default (now() + interval '30 days'),
  redeemed_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists loyalty_coupons_user_idx on public.loyalty_coupons(user_id, created_at desc);

create table if not exists public.mission_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_date date not null default (timezone('America/Sao_Paulo', now()))::date,
  mission_id text not null,
  points_awarded integer not null,
  created_at timestamptz not null default now(),
  unique(user_id, mission_date, mission_id)
);

create table if not exists public.skin_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  skin_id text not null,
  unlocked_at timestamptz not null default now(),
  primary key(user_id, skin_id)
);

-- Criar perfil automaticamente quando o cliente autenticar por telefone.
create or replace function public.handle_new_game_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.game_profiles(user_id, phone, display_name)
  values (new.id, nullif(new.phone,''), coalesce(nullif(new.raw_user_meta_data->>'display_name',''),'Chef ND'))
  on conflict (user_id) do update set phone = excluded.phone, updated_at = now();
  insert into public.skin_unlocks(user_id, skin_id) values(new.id,'classico') on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_game on auth.users;
create trigger on_auth_user_created_game after insert or update of phone on auth.users
for each row execute procedure public.handle_new_game_user();

-- Acesso direto do navegador é somente leitura do próprio perfil e dos próprios dados.
alter table public.game_profiles enable row level security;
alter table public.game_sessions enable row level security;
alter table public.points_ledger enable row level security;
alter table public.loyalty_coupons enable row level security;
alter table public.mission_claims enable row level security;
alter table public.skin_unlocks enable row level security;

drop policy if exists "profile read own" on public.game_profiles;
create policy "profile read own" on public.game_profiles for select to authenticated using (auth.uid() = user_id);
drop policy if exists "sessions read own" on public.game_sessions;
create policy "sessions read own" on public.game_sessions for select to authenticated using (auth.uid() = user_id);
drop policy if exists "ledger read own" on public.points_ledger;
create policy "ledger read own" on public.points_ledger for select to authenticated using (auth.uid() = user_id);
drop policy if exists "coupons read own" on public.loyalty_coupons;
create policy "coupons read own" on public.loyalty_coupons for select to authenticated using (auth.uid() = user_id);
drop policy if exists "missions read own" on public.mission_claims;
create policy "missions read own" on public.mission_claims for select to authenticated using (auth.uid() = user_id);
drop policy if exists "skins read own" on public.skin_unlocks;
create policy "skins read own" on public.skin_unlocks for select to authenticated using (auth.uid() = user_id);

-- Nenhuma policy de INSERT/UPDATE/DELETE para authenticated: alterações passam pela Edge Function.
revoke all on public.game_profiles, public.game_sessions, public.points_ledger, public.loyalty_coupons, public.mission_claims, public.skin_unlocks from anon, authenticated;
grant select on public.game_profiles, public.game_sessions, public.points_ledger, public.loyalty_coupons, public.mission_claims, public.skin_unlocks to authenticated;
grant all on public.game_profiles, public.game_sessions, public.points_ledger, public.loyalty_coupons, public.mission_claims, public.skin_unlocks to service_role;

-- RPCs executadas exclusivamente pela Edge Function com service_role.
create or replace function public.nd_start_game(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if (select count(*) from public.game_sessions
      where user_id=p_user_id and status='started' and created_at > now()-interval '3 minutes') > 0 then
    raise exception 'Já existe uma partida em andamento.';
  end if;
  insert into public.game_sessions(user_id) values(p_user_id) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.nd_finish_game(p_user_id uuid, p_session_id uuid, p_score integer, p_caught integer)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_session public.game_sessions%rowtype;
  v_award integer;
  v_bonus integer := 0;
  v_today date := (timezone('America/Sao_Paulo', now()))::date;
  v_games_today integer;
  v_caught_today integer;
  v_best integer;
  v_xp integer;
  v_level integer;
  v_mission text;
  v_reward integer;
begin
  select * into v_session from public.game_sessions
  where id=p_session_id and user_id=p_user_id for update;
  if not found or v_session.status <> 'started' then raise exception 'Partida inválida ou já encerrada.'; end if;
  if v_session.started_at > now()-interval '45 seconds' or v_session.started_at < now()-interval '4 minutes' then
    raise exception 'Tempo de partida inválido.';
  end if;
  if p_score < 0 or p_score > 1200 or p_caught < 0 or p_caught > 120 then
    raise exception 'Pontuação fora dos limites permitidos.';
  end if;

  v_award := floor(p_score::numeric/10)::integer*5;
  update public.game_sessions set finished_at=now(), score=p_score, caught=p_caught,
    points_awarded=v_award, status='finished' where id=p_session_id;
  insert into public.points_ledger(user_id,amount,kind,description,reference_id)
    values(p_user_id,v_award,'game','Pontos da partida',p_session_id);

  select count(*) into v_games_today from public.game_sessions
    where user_id=p_user_id and status='finished' and (finished_at at time zone 'America/Sao_Paulo')::date=v_today;
  select coalesce(sum(caught),0) into v_caught_today from public.game_sessions
    where user_id=p_user_id and status='finished' and (finished_at at time zone 'America/Sao_Paulo')::date=v_today;
  for v_mission,v_reward in
    select * from (values ('play1',30),('catch20',50),('score100',70)) as m(id,reward)
  loop
    if (v_mission='play1' and v_games_today>=1)
      or (v_mission='catch20' and v_caught_today>=20)
      or (v_mission='score100' and p_score>=100) then
      insert into public.mission_claims(user_id,mission_date,mission_id,points_awarded)
      values(p_user_id,v_today,v_mission,v_reward) on conflict do nothing;
      if found then
        v_bonus := v_bonus + v_reward;
        insert into public.points_ledger(user_id,amount,kind,description,reference_id)
        values(p_user_id,v_reward,'mission','Missão diária: '||v_mission,p_session_id);
      end if;
    end if;
  end loop;

  update public.game_profiles set
    points=points+v_award+v_bonus,
    xp=xp+p_score,
    level=floor((xp+p_score)::numeric/100)::integer+1,
    best_score=greatest(best_score,p_score),
    games_played=games_played+1,
    updated_at=now()
  where user_id=p_user_id
  returning best_score,xp,level into v_best,v_xp,v_level;

  insert into public.skin_unlocks(user_id,skin_id)
  select p_user_id, skin_id from (values
    ('classico',1),('street',2),('fogo',4),('ouro',6),('cyber',8),('lenda',10)
  ) as skins(skin_id,required_level) where v_level>=required_level
  on conflict do nothing;

  return jsonb_build_object('score',p_score,'points_awarded',v_award,'mission_bonus',v_bonus,
    'best_score',v_best,'xp',v_xp,'level',v_level);
end;
$$;

create or replace function public.nd_redeem_coupon(p_user_id uuid, p_percent integer)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_cost integer; v_code text; v_id uuid;
begin
  v_cost := case p_percent when 2 then 300 when 5 then 700 when 7 then 1200 when 10 then 2000 else null end;
  if v_cost is null then raise exception 'Recompensa inválida.'; end if;
  update public.game_profiles set points=points-v_cost,updated_at=now()
  where user_id=p_user_id and points>=v_cost;
  if not found then raise exception 'Pontos insuficientes.'; end if;
  v_code := 'ND'||p_percent||'-'||upper(substr(encode(gen_random_bytes(6),'hex'),1,10));
  insert into public.loyalty_coupons(user_id,code,discount_percent,points_cost)
  values(p_user_id,v_code,p_percent,v_cost) returning id into v_id;
  insert into public.points_ledger(user_id,amount,kind,description,reference_id)
  values(p_user_id,-v_cost,'redemption','Resgate de cupom de '||p_percent||'%',v_id);
  return jsonb_build_object('id',v_id,'code',v_code,'discount_percent',p_percent,'expires_at',now()+interval '30 days');
end;
$$;

create or replace function public.nd_validate_coupon(p_code text, p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_coupon public.loyalty_coupons%rowtype;
begin
  if not exists(select 1 from public.game_profiles where user_id=p_admin_id and role='admin') then
    raise exception 'Acesso administrativo não autorizado.';
  end if;
  select * into v_coupon from public.loyalty_coupons where code=upper(trim(p_code)) for update;
  if not found then return jsonb_build_object('valid',false,'message','Cupom não encontrado.'); end if;
  if v_coupon.status <> 'available' then return jsonb_build_object('valid',false,'message','Cupom já utilizado ou indisponível.'); end if;
  if v_coupon.expires_at < now() then
    update public.loyalty_coupons set status='expired' where id=v_coupon.id;
    return jsonb_build_object('valid',false,'message','Cupom expirado.');
  end if;
  update public.loyalty_coupons set status='used',used_at=now(),used_by=p_admin_id where id=v_coupon.id;
  return jsonb_build_object('valid',true,'discount_percent',v_coupon.discount_percent,'message','Cupom válido e marcado como utilizado.');
end;
$$;

revoke all on function public.nd_start_game(uuid), public.nd_finish_game(uuid,uuid,integer,integer),
  public.nd_redeem_coupon(uuid,integer), public.nd_validate_coupon(text,uuid) from public, anon, authenticated;
grant execute on function public.nd_start_game(uuid), public.nd_finish_game(uuid,uuid,integer,integer),
  public.nd_redeem_coupon(uuid,integer), public.nd_validate_coupon(text,uuid) to service_role;

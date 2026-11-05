-- ============================================================================
-- CIT · Paralela — schema completo
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode.
-- É idempotente: pode ser rodado de novo a cada atualização do site,
-- sem apagar mensagens, perfis ou operações já existentes.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- 1. TABELAS
-- ============================================================================

-- ---------- perfis ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  codename   text unique not null,
  role       text not null default 'agent',
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists created_at timestamptz not null default now();

-- ---------- cor de cada agente ----------
-- A cor identifica o codinome no chat e nas listas. Cada conta nova recebe a
-- cor menos usada da paleta, para dois agentes não nascerem iguais.
alter table public.profiles add column if not exists color text;
alter table public.profiles drop constraint if exists profiles_color_check;
alter table public.profiles add constraint profiles_color_check
  check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

create or replace function public.cit_palette()
returns text[] language sql immutable as $fn$
  select array[
    '#45e3ff','#9b5cff','#ff3fa4','#ff2e5f','#37ff8b','#ffc74d','#3d8bff','#ff7a1a',
    '#00ffd5','#c86bff','#ff5cf0','#7dff3f','#ffe14d','#4dffea','#ff8fa3','#8affff'
  ]
$fn$;

/** A cor da paleta que menos gente está usando; empate vai pela ordem dela. */
create or replace function public.cor_livre()
returns text language plpgsql stable security definer set search_path = public as $fn$
declare pal text[] := public.cit_palette(); escolhida text;
begin
  select p into escolhida
    from unnest(pal) as p
    left join public.profiles pr on pr.color = p
   group by p
   order by count(pr.id), array_position(pal, p)
   limit 1;
  return coalesce(escolhida, pal[1]);
end $fn$;

-- ---------- códigos de acesso ----------
create table if not exists public.invite_codes (
  code text primary key,
  role text not null
);

-- A versão anterior do projeto só conhecia 'agent' e 'command'. Derruba qualquer
-- CHECK antigo sobre `role` (o nome varia) antes de abrir espaço para 'admin'.
do $do$
declare c record;
begin
  for c in
    select rel.relname as tbl, con.conname as name
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace ns  on ns.oid  = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname in ('profiles','invite_codes')
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%role%'
  loop
    execute format('alter table public.%I drop constraint %I', c.tbl, c.name);
  end loop;
end $do$;

alter table public.profiles add constraint profiles_role_check
  check (role in ('agent','command','admin','master'));
alter table public.invite_codes add constraint invite_codes_role_check
  check (role in ('agent','command','admin','master'));

-- Mais de uma conta pode ter a credencial MASTER (ela decide quem mais
-- recebe). Versões antigas deste schema travavam numa única conta MASTER por
-- um índice único; ele sai daqui, sem travar quem já rodou a versão anterior.
drop index if exists public.one_master_only;

-- Os códigos de acesso NÃO ficam neste arquivo. Ele é versionado, e um código
-- escrito aqui é um código publicado: quem lê o repositório cria conta com o
-- cargo que quiser. Eles vivem só no banco, que é privado.
--
-- Definir ou trocar, no SQL Editor do Supabase:
--   insert into public.invite_codes (code, role) values ('...', 'agent')
--     on conflict (code) do update set role = excluded.role;
--   update public.invite_codes set code = '...' where role = 'command';
--   delete from public.invite_codes where code = '...';   -- aposenta o antigo
--
-- Rodar este arquivo de novo não mexe em nada que já esteja gravado.

-- Só numa instalação nova, com a tabela ainda vazia: nasce um código de ADMIN
-- aleatório para dar a primeira conta, já que sem ADMIN ninguém cria as outras.
-- Leia-o uma vez e troque por um seu:
--   select code from public.invite_codes where role = 'admin';
insert into public.invite_codes (code, role)
select upper(encode(extensions.gen_random_bytes(6), 'hex')), 'admin'
 where not exists (select 1 from public.invite_codes);

-- Mesma lógica para MASTER, a credencial que enxerga o nome real de todos:
-- enquanto não houver um código de MASTER pendente, nasce um. Leia-o e
-- cadastre a conta pela aba "Cadastrar agente" — depois APAGUE o código, que
-- vale para quantas contas quiserem usá-lo enquanto estiver lá:
--   select code from public.invite_codes where role = 'master';
--   delete from public.invite_codes where role = 'master';   -- depois de usar
insert into public.invite_codes (code, role)
select upper(encode(extensions.gen_random_bytes(6), 'hex')), 'master'
 where not exists (select 1 from public.invite_codes where role = 'master');

-- ---------- nomes reais (RP) ----------
-- O nome de verdade por trás do personagem. Fica fora de `profiles` de
-- propósito: `profiles` é lido por todo mundo autenticado (profiles_read usa
-- `using (true)`, porque o codinome e a cor aparecem no chat para todos), e
-- esta informação não pode vazar por tabela nenhuma — só quem tem a
-- credencial MASTER enxerga. Cada agente grava a própria linha, uma vez, pelo
-- RPC set_real_name(); dali em diante só MASTER volta a ler.
create table if not exists public.real_names (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  real_name  text not null,
  updated_at timestamptz not null default now()
);

-- ---------- MASTER permanente ----------
-- Contas que ninguém tira de MASTER, nem outro MASTER. Guardadas pelo id, não
-- pelo codinome: o codinome muda, e outro agente poderia assumir o antigo.
-- A trava vale para qualquer caminho (RPC ou escrita direta), pelo gatilho
-- trava_master_permanente mais abaixo. Para incluir outra conta:
--   insert into public.permanent_masters (profile_id)
--     select id from public.profiles where codename = '...';
create table if not exists public.permanent_masters (
  profile_id uuid primary key references public.profiles(id) on delete cascade
);

insert into public.permanent_masters (profile_id)
select id from public.profiles where lower(codename) = 'hermes'
on conflict do nothing;

-- ---------- categorias ----------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  everyone   boolean not null default false,
  position   int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.category_members (
  category_id uuid not null references public.categories(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id)  on delete cascade,
  primary key (category_id, profile_id)
);

-- ---------- canais ----------
create table if not exists public.channels (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  topic          text default '',
  category_id    uuid references public.categories(id) on delete set null,
  inherit_access boolean not null default true,
  everyone       boolean not null default false,
  position       int not null default 0,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create table if not exists public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (channel_id, profile_id)
);

-- ---------- trava por código ----------
-- Segunda camada, por cima da lista de acesso: quem não digitar o código não
-- entra, seja AGENTE, COMANDO ou ADMIN. `locked` é só o aviso de que existe
-- trava (pode ser lido por qualquer um); o código em si fica hasheado nas
-- tabelas abaixo, que o site nunca lê — só compara por verify_*_code().
alter table public.categories add column if not exists locked boolean not null default false;
alter table public.channels   add column if not exists locked boolean not null default false;

create table if not exists public.category_locks (
  category_id uuid primary key references public.categories(id) on delete cascade,
  code_hash   text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.channel_locks (
  channel_id uuid primary key references public.channels(id) on delete cascade,
  code_hash  text not null,
  created_at timestamptz not null default now()
);

-- ---------- ordem da barra lateral ----------
-- Vale para todos: quem tem COMANDO arrasta e reorganiza para o grupo inteiro.
-- `key` é 'geral', 'individuais', 'cat:<uuid>' ou 'chan:<uuid>'.
create table if not exists public.sidebar_order (
  key      text primary key,
  position int not null default 0
);

-- ---------- mensagens ----------
-- `channel` é uma chave de texto:
--   'geral'          canal público
--   'agent:<uuid>'   canal individual comando <-> agente
--   'chan:<uuid>'    canal criado pelo comando (tabela channels)
create table if not exists public.messages (
  id         bigint generated by default as identity primary key,
  channel    text not null,
  author_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
-- O schema anterior só conhecia 'geral' e 'agent:<uuid>'. O CHECK que ele deixou
-- em `channel` rejeita o formato novo 'chan:<uuid>', quebrando o envio de
-- mensagem em canal criado pelo comando. Pelo nome conhecido e, por garantia,
-- por varredura (o nome pode variar entre instalações).
alter table public.messages drop constraint if exists messages_channel_check;

do $do$
declare c record;
begin
  for c in
    select con.conname as name
      from pg_constraint con
     where con.conrelid = 'public.messages'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%channel%'
  loop
    execute format('alter table public.messages drop constraint %I', c.name);
  end loop;
end $do$;

alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists edited_by uuid references public.profiles(id) on delete set null;
create index if not exists messages_channel_idx on public.messages (channel, created_at);

-- ---------- operações ----------
create table if not exists public.operations (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null,
  title       text not null,
  f_date      text not null default '',
  f_time      text not null default '',
  f_place     text not null default '',
  f_nature    text not null default '',
  f_suspects  text not null default '',
  f_agents    text not null default '',
  f_witnesses text not null default '',
  f_victims   text not null default '',
  f_report    text not null default '',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.operations add column if not exists status text not null default 'ativa';
alter table public.operations drop constraint if exists operations_status_check;
alter table public.operations add constraint operations_status_check
  check (status in ('ativa','encerrada'));
create index if not exists operations_channel_idx on public.operations (channel, created_at desc);

-- ---------- relatos de uma operação ----------
create table if not exists public.operation_entries (
  id           uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations(id) on delete cascade,
  f_date       text not null default '',
  f_time       text not null default '',
  f_place      text not null default '',
  f_nature     text not null default '',
  f_suspects   text not null default '',
  f_agents     text not null default '',
  f_witnesses  text not null default '',
  f_victims    text not null default '',
  f_report     text not null default '',
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists operation_entries_op_idx on public.operation_entries (operation_id, created_at);

-- ---------- imagens anexadas ----------
-- O caminho de cada arquivo é '<id da operação>/<uuid>.<ext>', e é isso que
-- permite à policy de leitura reaproveitar a regra de acesso do canal.
alter table public.operations        add column if not exists images text[] not null default '{}';
alter table public.operation_entries add column if not exists images text[] not null default '{}';

insert into storage.buckets (id, name, public)
  values ('operacoes', 'operacoes', false)
  on conflict (id) do nothing;

drop policy if exists anexo_read   on storage.objects;
drop policy if exists anexo_insert on storage.objects;
drop policy if exists anexo_delete on storage.objects;

-- Ver o anexo exige poder ver o canal onde a operação vive.
create policy anexo_read on storage.objects for select to authenticated
using (
  bucket_id = 'operacoes'
  and exists (
    select 1 from public.operations o
     where o.id::text = split_part(name, '/', 1)
       and public.can_read_channel(o.channel)
  )
);

-- O envio acontece antes de a operação existir (ela é criada junto), então
-- aqui basta ser o dono do arquivo.
create policy anexo_insert on storage.objects for insert to authenticated
with check (bucket_id = 'operacoes' and owner = auth.uid());

create policy anexo_delete on storage.objects for delete to authenticated
using (bucket_id = 'operacoes' and (owner = auth.uid() or public.is_staff()));

-- ============================================================================
-- 2. FUNÇÕES DE APOIO
-- ============================================================================

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $fn$
  select role from public.profiles where id = auth.uid()
$fn$;

-- MASTER enxerga e pode tudo que COMANDO e ADMIN podem — é um ADMIN a mais,
-- com acesso exclusivo ao nome real por trás de cada personagem.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('command','admin','master'), false)
$fn$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('admin','master'), false)
$fn$;

-- Só a credencial MASTER passa aqui — é o que guarda o nome real do RP.
create or replace function public.is_master()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'master', false)
$fn$;

-- Uma categoria é visível para o ADMIN, para quem está na lista de acesso,
-- ou para todos quando `everyone` está marcado.
create or replace function public.can_see_category(cat uuid)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare ev boolean; uid uuid := auth.uid();
begin
  if uid is null or cat is null then return false; end if;
  if public.is_admin() then return true; end if;
  select everyone into ev from public.categories where id = cat;
  if not found then return false; end if;
  return ev or exists (select 1 from public.category_members
                        where category_id = cat and profile_id = uid);
end $fn$;

-- Visibilidade decidida SÓ pelas colunas recebidas, sem reconsultar a tabela.
-- É isso que permite usá-las na policy de SELECT da própria tabela: num
-- INSERT ... RETURNING a linha nova ainda não está visível para uma função,
-- então qualquer regra que fosse buscá-la de volta negaria a inserção.
-- `autor` entra na regra porque a lista de membros só é gravada depois do
-- INSERT: sem isso, uma categoria restrita ficaria invisível até para quem
-- acabou de criá-la, e o RETURNING seria negado.
drop function if exists public.category_visible(uuid, boolean);
create or replace function public.category_visible(cid uuid, ev boolean, autor uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_admin()
      or coalesce(ev, false)
      or autor = auth.uid()
      or exists (select 1 from public.category_members m
                  where m.category_id = cid and m.profile_id = auth.uid());
$fn$;

drop function if exists public.channel_visible(uuid, boolean, boolean, uuid);
create or replace function public.channel_visible(cat uuid, inh boolean, ev boolean, cid uuid, autor uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_admin()
      or autor = auth.uid()
      or (cat is not null and inh and public.can_see_category(cat))
      or ((cat is null or not inh)
          and (coalesce(ev, false)
               or exists (select 1 from public.channel_members m
                           where m.channel_id = cid and m.profile_id = auth.uid())));
$fn$;

-- Regra única de acesso a canal, usada por todas as policies.
create or replace function public.can_read_channel(ch text)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare
  cid uuid; cat uuid; inh boolean; ev boolean; aut uuid; uid uuid := auth.uid();
begin
  if uid is null or ch is null then return false; end if;
  if ch = 'geral' then return true; end if;
  if public.is_admin() then return true; end if;

  -- canal individual: o próprio agente e o comando
  if ch like 'agent:%' then
    return public.is_staff() or ch = 'agent:' || uid::text;
  end if;

  -- canal criado pelo comando
  if ch like 'chan:%' then
    begin
      cid := substring(ch from 6)::uuid;
    exception when others then
      return false;
    end;
    select category_id, inherit_access, everyone, created_by into cat, inh, ev, aut
      from public.channels where id = cid;
    if not found then return false; end if;
    return public.channel_visible(cat, inh, ev, cid, aut);
  end if;

  return false;
end $fn$;

-- Marca updated_at nas operações e relatos.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

drop trigger if exists operations_touch on public.operations;
create trigger operations_touch before update on public.operations
  for each row execute function public.touch_updated_at();

drop trigger if exists operation_entries_touch on public.operation_entries;
create trigger operation_entries_touch before update on public.operation_entries
  for each row execute function public.touch_updated_at();

-- Marca a mensagem como editada e impede troca de autor/canal.
create or replace function public.touch_message()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
    new.edited_by := auth.uid();
  end if;
  new.author_id  := old.author_id;
  new.channel    := old.channel;
  new.created_at := old.created_at;
  return new;
end $fn$;

drop trigger if exists messages_touch on public.messages;
create trigger messages_touch before update on public.messages
  for each row execute function public.touch_message();

-- /fukurou no começo da mensagem convoca o bot (seção 6): o prefixo sai do
-- texto e a mensagem fica marcada. Quem decide é o banco, nunca o cliente —
-- `fukurou` vindo pronto no INSERT é sobrescrito aqui. Só vale ao criar:
-- editar depois para pôr o prefixo não chama ninguém.
alter table public.messages add column if not exists fukurou boolean not null default false;

create or replace function public.marca_fukurou()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.fukurou := new.body ~* '^\s*/fukurou(\s|$)';
  if new.fukurou then
    new.body := regexp_replace(new.body, '^\s*/fukurou\s*', '', 'i');
    if btrim(new.body) = '' then
      raise exception 'Escreva a mensagem depois de /fukurou.';
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists marca_fukurou on public.messages;
create trigger marca_fukurou before insert on public.messages
  for each row execute function public.marca_fukurou();

-- Data da mensagem mais recente de cada canal. Serve ao aviso de não lida: o
-- site compara estas datas com a da última visita que ele guarda por conta.
-- O agrupamento pertence ao banco — trazer as mensagens só para achar o máximo
-- de cada canal seria carregar o que não se vai usar.
-- `security invoker` é o essencial: a função roda com o RLS de quem chamou,
-- então cada agente recebe apenas os canais que já podia ler. Com
-- `security definer` ela vazaria a existência e o movimento de canal fechado.
create or replace function public.ultimas_por_canal()
returns table (channel text, ultima timestamptz)
language sql stable security invoker set search_path = public as $fn$
  select m.channel, max(m.created_at) from public.messages m group by m.channel
$fn$;

-- ============================================================================
-- 3. CADASTRO DE NOVOS AGENTES
-- ============================================================================
-- O cargo vem do código de acesso digitado no cadastro; nunca do cliente.
-- `cit.new_role` só é definido por admin_create_user(), dentro da transação.
-- Quem se cadastra pelo código informa também o ID do Discord, que recebe os
-- avisos de mensagem nova (seção 6); conta criada pelo ADMIN pode vir sem.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r text; cn text; dc text := btrim(coalesce(new.raw_user_meta_data->>'discord', ''));
begin
  cn := coalesce(nullif(new.raw_user_meta_data->>'codename',''), split_part(new.email,'@',1));
  r  := nullif(current_setting('cit.new_role', true), '');
  if r is null then
    select role into r from public.invite_codes
      where code = new.raw_user_meta_data->>'code';
    if r is not null and dc = '' then
      raise exception 'Informe seu ID do Discord.';
    end if;
  end if;
  if r is null then
    raise exception 'Código de acesso inválido.';
  end if;
  insert into public.profiles (id, codename, role, color)
    values (new.id, cn, r, public.cor_livre());
  if dc <> '' then
    perform public.grava_discord(new.id, dc);
  end if;
  return new;
end $fn$;

-- Remove qualquer gatilho de cadastro da versão anterior (o nome pode ser outro);
-- dois gatilhos criariam o perfil duas vezes e quebrariam o cadastro.
do $do$
declare t record;
begin
  for t in
    select tg.tgname as name
      from pg_trigger   tg
      join pg_class     rel on rel.oid = tg.tgrelid
      join pg_namespace ns  on ns.oid  = rel.relnamespace
      join pg_proc      p   on p.oid   = tg.tgfoid
      join pg_namespace fns on fns.oid = p.pronamespace
     where ns.nspname = 'auth' and rel.relname = 'users'
       and fns.nspname = 'public' and not tg.tgisinternal
  loop
    execute format('drop trigger if exists %I on auth.users', t.name);
  end loop;
end $do$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 4. GERENCIAMENTO DE USUÁRIOS (RPC)
-- ============================================================================

-- ADMIN concede/remove privilégio de comando. MASTER, além disso, concede e
-- retira a própria credencial MASTER de outras contas.
create or replace function public.set_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then
    raise exception 'Apenas o ADMIN pode alterar privilégios.';
  end if;
  if new_role not in ('agent','command','admin','master') then
    raise exception 'Cargo inválido.';
  end if;
  if (new_role = 'master' or (select role from public.profiles where id = target) = 'master')
     and not public.is_master() then
    raise exception 'Só a credencial MASTER concede ou retira MASTER.';
  end if;
  if target = auth.uid() and new_role <> my_role() then
    raise exception 'Você não pode rebaixar a própria conta.';
  end if;
  update public.profiles set role = new_role where id = target;
end $fn$;

-- ADMIN cria contas direto pelo painel.
create or replace function public.admin_create_user(
  p_codename text, p_password text, p_role text default 'agent')
returns uuid language plpgsql security definer
set search_path = public, auth, extensions as $fn$
declare uid uuid := gen_random_uuid(); mail text;
begin
  if not public.is_admin() then
    raise exception 'Apenas o ADMIN pode criar contas.';
  end if;
  if p_codename !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Codinome: 3 a 20 caracteres (letras, números e _).';
  end if;
  if length(p_password) < 6 then
    raise exception 'Senha: mínimo de 6 caracteres.';
  end if;
  if p_role not in ('agent','command','admin') then
    raise exception 'Cargo inválido.';
  end if;

  mail := lower(p_codename) || '.cit.paralela@gmail.com';
  if exists (select 1 from auth.users where email = mail) then
    raise exception 'Já existe um agente com esse codinome.';
  end if;

  perform set_config('cit.new_role', p_role, true);

  -- os campos de token vão como '' (e não null): o GoTrue falha ao ler null neles
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new)
  values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    mail, extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('codename', p_codename), now(), now(),
    '', '', '', '');

  begin
    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      uid::text, uid, jsonb_build_object('sub', uid::text, 'email', mail),
      'email', now(), now(), now());
  exception when not_null_violation then
    -- versões antigas do GoTrue exigem auth.identities.id explícito
    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      uid::text, uid::text, uid, jsonb_build_object('sub', uid::text, 'email', mail),
      'email', now(), now(), now());
  end;

  perform set_config('cit.new_role', '', true);
  return uid;
end $fn$;

-- ADMIN troca o codinome de um agente. Como o login é derivado do codinome,
-- o e-mail interno e a identidade mudam junto: a partir daí o agente entra
-- com o nome novo e a senha antiga.
create or replace function public.set_codename(target uuid, new_name text)
returns void language plpgsql security definer
set search_path = public, auth as $fn$
declare mail text;
begin
  if not public.is_admin() then
    raise exception 'Apenas o ADMIN pode alterar codinomes.';
  end if;
  if target <> auth.uid() and (select role from public.profiles where id = target) = 'master' then
    raise exception 'Só a própria credencial MASTER altera essa conta.';
  end if;
  if new_name !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Codinome: 3 a 20 caracteres (letras, números e _).';
  end if;
  if exists (select 1 from public.profiles where codename = new_name and id <> target) then
    raise exception 'Já existe um agente com esse codinome.';
  end if;

  mail := lower(new_name) || '.cit.paralela@gmail.com';
  if exists (select 1 from auth.users where email = mail and id <> target) then
    raise exception 'Já existe uma conta com esse codinome.';
  end if;

  update public.profiles set codename = new_name where id = target;

  update auth.users
     set email = mail,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('codename', new_name),
         updated_at = now()
   where id = target;

  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb)
                         || jsonb_build_object('email', mail),
         updated_at = now()
   where user_id = target and provider = 'email';
end $fn$;

-- Cada agente ajusta o próprio codinome e a própria cor. Vale para todos os
-- cargos; é a única configuração a que o AGENTE tem acesso.
create or replace function public.update_me(new_name text, new_color text)
returns void language plpgsql security definer
set search_path = public, auth as $fn$
declare mail text; atual text; eu uuid := auth.uid();
begin
  if eu is null then
    raise exception 'Sessão expirada. Entre de novo.';
  end if;
  if new_color is not null and new_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Cor inválida.';
  end if;

  select codename into atual from public.profiles where id = eu;

  if new_name is not null and new_name <> atual then
    if new_name !~ '^[A-Za-z0-9_]{3,20}$' then
      raise exception 'Codinome: 3 a 20 caracteres (letras, números e _).';
    end if;
    if exists (select 1 from public.profiles where codename = new_name and id <> eu) then
      raise exception 'Já existe um agente com esse codinome.';
    end if;
    mail := lower(new_name) || '.cit.paralela@gmail.com';
    if exists (select 1 from auth.users where email = mail and id <> eu) then
      raise exception 'Já existe uma conta com esse codinome.';
    end if;

    update public.profiles set codename = new_name where id = eu;
    update auth.users
       set email = mail,
           raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                                || jsonb_build_object('codename', new_name),
           updated_at = now()
     where id = eu;
    update auth.identities
       set identity_data = coalesce(identity_data, '{}'::jsonb)
                           || jsonb_build_object('email', mail),
           updated_at = now()
     where user_id = eu and provider = 'email';
  end if;

  if new_color is not null then
    update public.profiles set color = new_color where id = eu;
  end if;
end $fn$;

-- Cada conta grava o próprio nome real (RP), geralmente uma vez só, logo após
-- o primeiro login. security definer de propósito: a escrita direta na tabela
-- é só para MASTER (ver RLS), então o próprio agente só consegue gravar a
-- própria linha por este caminho.
create or replace function public.set_real_name(p_name text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre de novo.';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Nome: mínimo de 2 caracteres.';
  end if;
  insert into public.real_names (profile_id, real_name, updated_at)
       values (auth.uid(), btrim(p_name), now())
  on conflict (profile_id) do update set real_name = excluded.real_name, updated_at = now();
end $fn$;

-- ADMIN troca a cor de qualquer conta.
create or replace function public.admin_set_color(target uuid, new_color text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then
    raise exception 'Apenas o ADMIN pode alterar a cor de outra conta.';
  end if;
  if target <> auth.uid() and (select role from public.profiles where id = target) = 'master' then
    raise exception 'Só a própria credencial MASTER altera essa conta.';
  end if;
  if new_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Cor inválida.';
  end if;
  update public.profiles set color = new_color where id = target;
end $fn$;

-- ADMIN redefine a senha de qualquer conta.
create or replace function public.admin_set_password(target uuid, p_password text)
returns void language plpgsql security definer
set search_path = public, auth, extensions as $fn$
begin
  if not public.is_admin() then
    raise exception 'Apenas o ADMIN pode redefinir senhas.';
  end if;
  if target <> auth.uid() and (select role from public.profiles where id = target) = 'master' then
    raise exception 'Só a própria credencial MASTER redefine essa senha.';
  end if;
  if length(p_password) < 6 then
    raise exception 'Senha: mínimo de 6 caracteres.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = target;
end $fn$;

-- Remoção de conta. COMANDO remove agentes; ADMIN remove qualquer um (menos a si).
-- A versão anterior pode ter outro tipo de retorno, o que impediria o "replace".
drop function if exists public.remove_agent(uuid);
create or replace function public.remove_agent(target uuid)
returns void language plpgsql security definer set search_path = public, auth as $fn$
declare r text;
begin
  select role into r from public.profiles where id = target;
  if r is null then
    raise exception 'Agente não encontrado.';
  end if;
  if target = auth.uid() then
    raise exception 'Você não pode remover a própria conta.';
  end if;
  if r = 'master' then
    raise exception 'A conta MASTER não pode ser removida por aqui.';
  end if;
  if public.is_admin() then
    null;
  elsif public.is_staff() and r = 'agent' then
    null;
  else
    raise exception 'Sem permissão para remover esta conta.';
  end if;

  delete from public.messages where channel = 'agent:' || target::text;
  delete from auth.users where id = target;   -- cascata apaga o perfil
end $fn$;

create or replace function public.admin_delete_user(target uuid)
returns void language sql security definer set search_path = public as $fn$
  select public.remove_agent(target);
$fn$;

-- ---------- trava de acesso por código ----------
-- Quem cria ou edita define o código; passar nulo ou vazio tira a trava.
-- Só o hash é guardado: nem o site nem quem consulta a tabela lê o código.
create or replace function public.set_channel_lock(cid uuid, code text default null)
returns void language plpgsql security definer
set search_path = public, extensions as $fn$
begin
  if not public.is_staff() then
    raise exception 'Apenas COMANDO ou ADMIN definem a trava de um canal.';
  end if;
  if not exists (select 1 from public.channels where id = cid) then
    raise exception 'Canal não encontrado.';
  end if;

  if code is null or btrim(code) = '' then
    delete from public.channel_locks where channel_id = cid;
    update public.channels set locked = false where id = cid;
    return;
  end if;
  if length(btrim(code)) < 3 then
    raise exception 'Código de acesso: mínimo de 3 caracteres.';
  end if;

  insert into public.channel_locks (channel_id, code_hash)
       values (cid, extensions.crypt(btrim(code), extensions.gen_salt('bf')))
  on conflict (channel_id) do update set code_hash = excluded.code_hash;
  update public.channels set locked = true where id = cid;
end $fn$;

create or replace function public.set_category_lock(cat uuid, code text default null)
returns void language plpgsql security definer
set search_path = public, extensions as $fn$
begin
  if not public.is_staff() then
    raise exception 'Apenas COMANDO ou ADMIN definem a trava de uma categoria.';
  end if;
  if not exists (select 1 from public.categories where id = cat) then
    raise exception 'Categoria não encontrada.';
  end if;

  if code is null or btrim(code) = '' then
    delete from public.category_locks where category_id = cat;
    update public.categories set locked = false where id = cat;
    return;
  end if;
  if length(btrim(code)) < 3 then
    raise exception 'Código de acesso: mínimo de 3 caracteres.';
  end if;

  insert into public.category_locks (category_id, code_hash)
       values (cat, extensions.crypt(btrim(code), extensions.gen_salt('bf')))
  on conflict (category_id) do update set code_hash = excluded.code_hash;
  update public.categories set locked = true where id = cat;
end $fn$;

-- Confere o código digitado. A trava é uma camada a mais, não substitui o RLS:
-- quem já não enxergava o canal continua recebendo "não".
create or replace function public.verify_channel_code(cid uuid, code text)
returns boolean language plpgsql security definer
set search_path = public, extensions as $fn$
declare h text;
begin
  if not public.can_read_channel('chan:' || cid::text) then
    return false;
  end if;
  select code_hash into h from public.channel_locks where channel_id = cid;
  if h is null then return true; end if;
  return h = extensions.crypt(coalesce(code, ''), h);
end $fn$;

create or replace function public.verify_category_code(cat uuid, code text)
returns boolean language plpgsql security definer
set search_path = public, extensions as $fn$
declare h text;
begin
  if not public.can_see_category(cat) then
    return false;
  end if;
  select code_hash into h from public.category_locks where category_id = cat;
  if h is null then return true; end if;
  return h = extensions.crypt(coalesce(code, ''), h);
end $fn$;

-- ---------- cores das contas que já existiam ----------
update public.profiles set color = '#ff3fa4' where color is null and lower(codename) = 'nemesis';
update public.profiles set color = '#ff2e5f' where color is null and lower(codename) = 'aries';

do $do$
declare r record;
begin
  for r in select id from public.profiles where color is null order by created_at loop
    update public.profiles set color = public.cor_livre() where id = r.id;
  end loop;
end $do$;

-- ============================================================================
-- 5. RLS
-- ============================================================================
alter table public.sidebar_order     enable row level security;
alter table public.profiles          enable row level security;
alter table public.invite_codes      enable row level security;
alter table public.categories        enable row level security;
alter table public.category_members  enable row level security;
alter table public.category_locks    enable row level security;
alter table public.channels          enable row level security;
alter table public.channel_members   enable row level security;
alter table public.channel_locks     enable row level security;
alter table public.messages          enable row level security;
alter table public.operations        enable row level security;
alter table public.operation_entries enable row level security;
alter table public.real_names        enable row level security;

-- limpa policies antigas (inclusive as de versões anteriores do projeto)
do $do$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
     where schemaname = 'public'
       and tablename in ('profiles','invite_codes','categories','category_members',
                         'category_locks','channels','channel_members','channel_locks',
                         'messages','operations','operation_entries','sidebar_order','real_names')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $do$;

-- ---------- profiles ----------
create policy profiles_read   on public.profiles for select to authenticated using (true);
-- Além de exigir ADMIN, barra a linha MASTER para quem não for MASTER — sem
-- isso, um ADMIN comum contornaria as travas de set_role()/admin_set_*()
-- escrevendo direto na tabela por baixo do RPC.
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin() and (role <> 'master' or public.is_master()))
  with check (public.is_admin() and (role <> 'master' or public.is_master()));

-- ---------- MASTER permanente ----------
-- Todos leem a lista (é só para o painel esconder o botão); ninguém escreve
-- pela REST — só pelo SQL Editor.
alter table public.permanent_masters enable row level security;
drop policy if exists permanent_masters_read on public.permanent_masters;
create policy permanent_masters_read on public.permanent_masters for select
  to authenticated using (true);

create or replace function public.trava_master_permanente()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if old.role = 'master' and new.role <> 'master'
     and exists (select 1 from public.permanent_masters where profile_id = old.id) then
    raise exception '% não pode deixar de ser MASTER.', old.codename;
  end if;
  return new;
end $fn$;

drop trigger if exists trava_master_permanente on public.profiles;
create trigger trava_master_permanente before update of role on public.profiles
  for each row execute function public.trava_master_permanente();

-- ---------- nomes reais (RP) ----------
-- Cada um lê a própria linha (para saber o que já gravou); só MASTER lê as
-- demais. Escrita direta pela REST é só para MASTER — o resto grava pelo RPC
-- set_real_name(), que roda como security definer e passa por cima do RLS.
create policy realname_read  on public.real_names for select to authenticated
  using (profile_id = auth.uid() or public.is_master());
create policy realname_write on public.real_names for all to authenticated
  using (public.is_master()) with check (public.is_master());

-- ---------- invite_codes ----------
create policy codes_read  on public.invite_codes for select to authenticated using (public.is_admin());
create policy codes_write on public.invite_codes for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- ordem da barra ----------
create policy ord_read  on public.sidebar_order for select to authenticated using (true);
create policy ord_write on public.sidebar_order for all    to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- categorias ----------
-- Estas quatro usam category_visible(id, everyone), que decide pelas colunas da
-- linha. Usar can_see_category(id) aqui reconsultaria a própria tabela e
-- quebraria o INSERT ... RETURNING de uma categoria nova.
create policy cat_read   on public.categories for select to authenticated
  using (public.category_visible(id, everyone, created_by));
create policy cat_insert on public.categories for insert to authenticated
  with check (public.is_staff());
create policy cat_update on public.categories for update to authenticated
  using (public.is_staff() and public.category_visible(id, everyone, created_by))
  with check (public.is_staff());
create policy cat_delete on public.categories for delete to authenticated
  using (public.is_staff() and public.category_visible(id, everyone, created_by));

create policy catm_read  on public.category_members for select to authenticated
  using (public.can_see_category(category_id) or profile_id = auth.uid());
create policy catm_write on public.category_members for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- canais ----------
-- Mesmo motivo: channel_visible() decide pelas colunas, sem voltar na tabela.
create policy ch_read   on public.channels for select to authenticated
  using (public.channel_visible(category_id, inherit_access, everyone, id, created_by));
create policy ch_insert on public.channels for insert to authenticated
  with check (public.is_staff());
create policy ch_update on public.channels for update to authenticated
  using (public.is_staff() and public.channel_visible(category_id, inherit_access, everyone, id, created_by))
  with check (public.is_staff());
create policy ch_delete on public.channels for delete to authenticated
  using (public.is_staff() and public.channel_visible(category_id, inherit_access, everyone, id, created_by));

create policy chm_read  on public.channel_members for select to authenticated
  using (public.can_read_channel('chan:' || channel_id::text) or profile_id = auth.uid());
create policy chm_write on public.channel_members for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- travas ----------
-- Ninguém lê estas tabelas pelo site: quem define usa set_*_lock() e quem tenta
-- entrar usa verify_*_code(). Fora isso, só COMANDO e ADMIN alcançam as linhas.
create policy catlock_all on public.category_locks for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy chlock_all  on public.channel_locks  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- mensagens ----------
create policy msg_read   on public.messages for select to authenticated
  using (public.can_read_channel(channel));
create policy msg_insert on public.messages for insert to authenticated
  with check (author_id = auth.uid() and public.can_read_channel(channel));
-- autor edita a própria mensagem; COMANDO/ADMIN edita qualquer uma
create policy msg_update on public.messages for update to authenticated
  using (public.can_read_channel(channel) and (author_id = auth.uid() or public.is_staff()))
  with check (public.can_read_channel(channel));
create policy msg_delete on public.messages for delete to authenticated
  using (public.can_read_channel(channel) and (author_id = auth.uid() or public.is_staff()));

-- ---------- operações ----------
create policy op_read   on public.operations for select to authenticated
  using (public.can_read_channel(channel));
create policy op_insert on public.operations for insert to authenticated
  with check (public.can_read_channel(channel) and created_by = auth.uid());
create policy op_update on public.operations for update to authenticated
  using (public.can_read_channel(channel)) with check (public.can_read_channel(channel));
create policy op_delete on public.operations for delete to authenticated
  using (public.can_read_channel(channel) and (created_by = auth.uid() or public.is_staff()));

create policy ope_read   on public.operation_entries for select to authenticated
  using (exists (select 1 from public.operations o
                  where o.id = operation_id and public.can_read_channel(o.channel)));
create policy ope_insert on public.operation_entries for insert to authenticated
  with check (created_by = auth.uid()
              and exists (select 1 from public.operations o
                           where o.id = operation_id and public.can_read_channel(o.channel)));
create policy ope_update on public.operation_entries for update to authenticated
  using (exists (select 1 from public.operations o
                  where o.id = operation_id and public.can_read_channel(o.channel))
         and (created_by = auth.uid() or public.is_staff()));
create policy ope_delete on public.operation_entries for delete to authenticated
  using (exists (select 1 from public.operations o
                  where o.id = operation_id and public.can_read_channel(o.channel))
         and (created_by = auth.uid() or public.is_staff()));

-- ============================================================================
-- 6. AVISO NO DISCORD
-- ============================================================================
-- Mensagem que começa com /fukurou chama o bot: quem pode ler o canal (menos
-- o autor) recebe dele, no privado do Discord, o aviso — nunca o conteúdo.
-- O caminho: gatilho avisa_discord → pg_net → Edge Function `sinal`
-- (supabase/functions/sinal) → API do Discord. Sem linha em discord_config o
-- gatilho não faz nada, e o site segue igual.
create extension if not exists pg_net;

-- ID do Discord de cada conta. Revela quem está por trás do codinome, então é
-- tão reservado quanto o nome real: cada um lê só a própria linha e grava pelo
-- RPC set_discord_id. `last_ping` é a data do último aviso: é por ela que a
-- escuta do Fukurou descobre quem já recebeu algo do bot.
create table if not exists public.discord_links (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  discord_id text not null check (discord_id ~ '^[0-9]{17,20}$'),
  last_ping  timestamptz
);

-- Endereço da Edge Function e o segredo que ela confere. Linha única, sem
-- policy nenhuma: invisível pela REST, só o SQL Editor lê e grava.
-- `anon_key` é a chave pública do config.js: a porta das Edge Functions exige
-- um JWT válido, e ela basta para passar. Quem protege a função é o `secret`.
--   insert into public.discord_config (url, secret, anon_key)
--   values ('https://<projeto>.supabase.co/functions/v1/sinal', '<segredo>', '<chave anon>')
--   on conflict (id) do update
--     set url = excluded.url, secret = excluded.secret, anon_key = excluded.anon_key;
create table if not exists public.discord_config (
  id        boolean primary key default true check (id),
  url       text not null,
  secret    text not null
);
alter table public.discord_config add column if not exists anon_key text;
-- Havia um intervalo mínimo entre dois avisos à mesma pessoa. Saiu quando o
-- aviso passou a exigir /fukurou: quem chama o bot quer que ele vá, toda vez.
alter table public.discord_config drop column if exists intervalo;

alter table public.discord_links  enable row level security;
alter table public.discord_config enable row level security;
-- O ADMIN também lê: é ele quem cadastra o ID de quem ainda não tem.
drop policy if exists discord_read on public.discord_links;
create policy discord_read on public.discord_links for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

-- Grava (ou apaga, se vier vazio) o ID do Discord de uma conta. Não confere
-- quem pede: isso fica com quem chama — set_discord_id, admin_set_discord_id
-- e o cadastro (handle_new_user). Por isso ninguém de fora a executa.
create or replace function public.grava_discord(target uuid, p_id text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v text := btrim(coalesce(p_id, ''));
begin
  if v = '' then
    delete from public.discord_links where profile_id = target;
    return;
  end if;
  if v !~ '^[0-9]{17,20}$' then
    raise exception 'ID do Discord: só números, de 17 a 20 dígitos.';
  end if;
  insert into public.discord_links (profile_id, discord_id) values (target, v)
  on conflict (profile_id) do update set discord_id = excluded.discord_id;
end $fn$;
revoke execute on function public.grava_discord(uuid, text) from public, anon, authenticated;

-- Cada conta grava o próprio ID (minhas configurações).
create or replace function public.set_discord_id(p_id text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre de novo.';
  end if;
  perform public.grava_discord(auth.uid(), p_id);
end $fn$;

-- ADMIN grava o ID de qualquer conta (painel ⚙), com a mesma ressalva de
-- sempre para MASTER: só a própria credencial mexe nela.
create or replace function public.admin_set_discord_id(target uuid, p_id text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then
    raise exception 'Apenas o ADMIN pode alterar o Discord de outra conta.';
  end if;
  if target <> auth.uid() and (select role from public.profiles where id = target) = 'master' then
    raise exception 'Só a própria credencial MASTER altera essa conta.';
  end if;
  perform public.grava_discord(target, p_id);
end $fn$;

-- Todas as contas que podem ler um canal. É a regra de can_read_channel vista
-- do lado do canal: lá se pergunta "eu posso?", aqui "quem pode?". Mudou uma,
-- muda a outra. A trava por código fica de fora — ela pede o código a cada
-- sessão, mas quem está na lista de acesso continua sendo do canal.
create or replace function public.leitores_do_canal(ch text)
returns setof uuid language plpgsql stable security definer set search_path = public as $fn$
declare cid uuid; cat uuid; inh boolean; ev boolean; aut uuid; cat_ev boolean;
begin
  if ch = 'geral' then
    return query select id from public.profiles;
    return;
  end if;

  if ch like 'agent:%' then
    return query select id from public.profiles
                  where role in ('command','admin','master') or 'agent:' || id::text = ch;
    return;
  end if;

  if ch like 'chan:%' then
    begin
      cid := substring(ch from 6)::uuid;
    exception when others then
      return;
    end;
    select category_id, inherit_access, everyone, created_by into cat, inh, ev, aut
      from public.channels where id = cid;
    if not found then return; end if;

    if cat is not null and inh then
      select everyone into cat_ev from public.categories where id = cat;
      return query select p.id from public.profiles p
                    where p.role in ('admin','master') or p.id = aut or coalesce(cat_ev, false)
                       or exists (select 1 from public.category_members m
                                   where m.category_id = cat and m.profile_id = p.id);
    else
      return query select p.id from public.profiles p
                    where p.role in ('admin','master') or p.id = aut or coalesce(ev, false)
                       or exists (select 1 from public.channel_members m
                                   where m.channel_id = cid and m.profile_id = p.id);
    end if;
  end if;
end $fn$;

-- Ninguém de fora precisa perguntar quem lê cada canal: só o gatilho usa.
revoke execute on function public.leitores_do_canal(text) from public, anon, authenticated;

-- ---------- Fukurou ----------
-- Fukurou é o bot visto de dentro: a página só de MASTER que espelha cada
-- conversa dele no Discord, deixa responder em nome dele e define o texto do
-- aviso. Quem escreve nas duas primeiras tabelas é só a Edge Function, com a
-- chave de serviço (que passa por cima do RLS); o site apenas lê.

-- Uma linha por pessoa com quem o bot já falou. `last_msg_id` marca até onde
-- o espelho já buscou; `updated_at` é a última atividade e ordena a barra.
create table if not exists public.fukurou_chats (
  discord_id    text primary key,
  dm_channel_id text not null,
  username      text,
  display_name  text,
  last_msg_id   text,
  updated_at    timestamptz not null default now()
);

-- Cada mensagem da conversa, das duas direções. O id é o do próprio Discord,
-- o que torna inofensivo buscar a mesma mensagem duas vezes. `sent_by` é o
-- MASTER que escreveu pelo site, quando foi o caso.
create table if not exists public.fukurou_msgs (
  id         text primary key,
  discord_id text not null references public.fukurou_chats(discord_id) on delete cascade,
  from_bot   boolean not null,
  body       text not null default '',
  sent_by    uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null
);
create index if not exists fukurou_msgs_chat_idx on public.fukurou_msgs (discord_id, created_at);

-- O texto do aviso de mensagem nova. Rodar o schema de novo não o sobrescreve.
create table if not exists public.fukurou_settings (
  id    boolean primary key default true check (id),
  aviso text not null check (length(btrim(aviso)) between 1 and 2000)
);
insert into public.fukurou_settings (aviso)
values ('Sinal interceptado.... realidade não catalogada... verifique o sistema interno do CIT, uma nova mensagem lhe aguarda')
on conflict (id) do nothing;

alter table public.fukurou_chats    enable row level security;
alter table public.fukurou_msgs     enable row level security;
alter table public.fukurou_settings enable row level security;
drop policy if exists fukurou_chats_read on public.fukurou_chats;
drop policy if exists fukurou_msgs_read  on public.fukurou_msgs;
drop policy if exists fukurou_cfg_read   on public.fukurou_settings;
drop policy if exists fukurou_cfg_write  on public.fukurou_settings;
create policy fukurou_chats_read on public.fukurou_chats    for select to authenticated using (public.is_master());
create policy fukurou_msgs_read  on public.fukurou_msgs     for select to authenticated using (public.is_master());
create policy fukurou_cfg_read   on public.fukurou_settings for select to authenticated using (public.is_master());
create policy fukurou_cfg_write  on public.fukurou_settings for update to authenticated
  using (public.is_master()) with check (public.is_master());

-- Chama a Edge Function `sinal` com o pedido recebido. pg_net é assíncrono:
-- quem chama não espera o Discord. Sem discord_config, não faz nada.
create or replace function public.chama_sinal(pedido jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
declare cfg record;
begin
  select * into cfg from public.discord_config where id;
  if not found then return; end if;
  perform net.http_post(
    url     := cfg.url,
    body    := pedido,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-sinal-secret', cfg.secret)
               || case when cfg.anon_key is null then '{}'::jsonb
                       else jsonb_build_object('Authorization', 'Bearer ' || cfg.anon_key,
                                               'apikey', cfg.anon_key) end,
    timeout_milliseconds := 30000);
end $fn$;
revoke execute on function public.chama_sinal(jsonb) from public, anon, authenticated;

-- Só mensagem que começou com /fukurou (marca_fukurou) chama o bot. Escolhe
-- quem avisar, marca o horário e entrega a lista à Edge Function, com o texto
-- atual do aviso. Qualquer falha aqui vira só um aviso no log — o envio da
-- mensagem nunca é barrado pelo bot.
create or replace function public.avisa_discord()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare ids text[]; texto text;
begin
  if not new.fukurou then return null; end if;
  if not exists (select 1 from public.discord_config where id) then return null; end if;

  with alvo as (
    update public.discord_links d set last_ping = now()
     where d.profile_id in (select public.leitores_do_canal(new.channel))
       and d.profile_id <> new.author_id
    returning d.discord_id
  )
  select array_agg(discord_id) into ids from alvo;
  if ids is null then return null; end if;

  select aviso into texto from public.fukurou_settings where id;
  perform public.chama_sinal(jsonb_build_object('acao', 'avisar', 'ids', to_jsonb(ids), 'texto', texto));
  return null;
exception when others then
  raise warning 'avisa_discord: %', sqlerrm;
  return null;
end $fn$;

drop trigger if exists avisa_discord on public.messages;
create trigger avisa_discord after insert on public.messages
  for each row execute function public.avisa_discord();

-- O Discord não avisa quando alguém responde ao bot — só entregaria a um
-- programa conectado o tempo todo, e aqui não há nenhum. Então o banco
-- pergunta: a cada 10 segundos a função busca o que chegou em cada conversa.
-- Sem pg_cron disponível, o resto segue funcionando, só sem as respostas.
do $do$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('fukurou-escuta', '10 seconds',
                        $$select public.chama_sinal('{"acao":"escutar"}')$$);
exception when others then
  raise warning 'fukurou-escuta não agendada: %', sqlerrm;
end $do$;

-- ============================================================================
-- 7. TEIA DE VÍNCULOS
-- ============================================================================
-- Tudo que a apuração consegue identificar deixa de ser texto solto no dossiê e
-- passa a ser uma entidade com id próprio: a mesma pessoa, o mesmo local e o
-- mesmo veículo são sempre a mesma linha, apareçam em quantas operações
-- aparecerem. É isso que deixa cruzar operações com segurança — e é disso que a
-- teia é desenhada.
--
-- O texto antigo não é jogado fora. As colunas f_suspects, f_agents,
-- f_witnesses, f_victims e f_place continuam existindo e, no dossiê já
-- convertido, viram espelho das entidades ligadas a ele (ver
-- `espelha_envolvidos` mais abaixo): assim a busca do Ctrl+F e o PDF seguem
-- funcionando sem saber que o modelo mudou, e um banco convertido pela metade
-- nunca mostra dossiê em branco.

create extension if not exists pg_trgm with schema extensions;

-- Caminho de anexo é texto: um pedaço que não seja uuid não pode derrubar a
-- policy inteira com erro de conversão.
create or replace function public.uuid_ou_nulo(t text)
returns uuid language plpgsql immutable set search_path = '' as $fn$
begin
  return t::uuid;
exception when others then
  return null;
end $fn$;

-- ---------- a entidade ----------
-- `kind` é o que a coisa é; o papel dela numa investigação ("chefe do
-- MOTOCLUB", "testemunha") não mora aqui, mora na ligação com a operação —
-- a mesma pessoa é chefe numa e testemunha em outra sem virar dois cadastros.
create table if not exists public.entities (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'pessoa',
  name       text not null,
  abbr       text not null default '',   -- a sigla do nó no grafo (MC, BD, C-B)
  summary    text not null default '',
  tags       text[] not null default '{}',
  images     text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.entities drop constraint if exists entities_kind_check;
alter table public.entities add constraint entities_kind_check
  check (kind in ('pessoa','local','veiculo','organizacao','informacao'));

create index if not exists entities_name_trgm
  on public.entities using gin (name extensions.gin_trgm_ops);

drop trigger if exists entities_touch on public.entities;
create trigger entities_touch before update on public.entities
  for each row execute function public.touch_updated_at();

-- ---------- apelidos e nomes alternativos ----------
create table if not exists public.entity_aliases (
  entity_id uuid not null references public.entities(id) on delete cascade,
  alias     text not null,
  primary key (entity_id, alias)
);

create index if not exists entity_aliases_trgm
  on public.entity_aliases using gin (alias extensions.gin_trgm_ops);

-- ---------- entidade × operação ----------
-- A linha que faz todo o resto existir: é contando as operações de uma mesma
-- entidade que se descobre que ela liga duas investigações.
--   `slot` diz em que campo do dossiê a entidade aparece (e qual coluna de
--   texto ela espelha);  `role` é o rótulo humano mostrado na teia.
create table if not exists public.entity_operations (
  entity_id    uuid not null references public.entities(id)   on delete cascade,
  operation_id uuid not null references public.operations(id) on delete cascade,
  slot         text not null default 'other',
  role         text not null default '',
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (entity_id, operation_id)
);

alter table public.entity_operations drop constraint if exists entity_operations_slot_check;
alter table public.entity_operations add constraint entity_operations_slot_check
  check (slot in ('suspects','agents','witnesses','victims','place','other'));

create index if not exists entity_operations_op_idx on public.entity_operations (operation_id);

-- Marca o dossiê já convertido para entidades. Nulo = ainda só texto livre,
-- e enquanto for nulo o espelho não encosta nas colunas antigas.
alter table public.operations add column if not exists entities_at timestamptz;

-- ---------- quem enxerga a entidade ----------
-- A entidade herda o sigilo das operações em que aparece: quem alcança
-- qualquer uma delas, a enxerga. Entidade ainda sem operação nenhuma é
-- rascunho de quem a cadastrou.
create or replace function public.can_see_entity(e uuid)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare dono uuid;
begin
  if e is null or auth.uid() is null then return false; end if;
  if public.is_admin() then return true; end if;

  if exists (select 1
               from public.entity_operations eo
               join public.operations o on o.id = eo.operation_id
              where eo.entity_id = e
                and public.can_read_channel(o.channel)) then
    return true;
  end if;

  if not exists (select 1 from public.entity_operations where entity_id = e) then
    select created_by into dono from public.entities where id = e;
    return dono = auth.uid() or public.is_staff();
  end if;

  return false;
end $fn$;

-- ---------- espelho nas colunas de texto ----------
create or replace function public.lista_slot(op uuid, s text)
returns text language sql stable security definer set search_path = public as $fn$
  select coalesce(string_agg(
           e.name || case when btrim(eo.role) <> '' then ' (' || eo.role || ')' else '' end,
           ', ' order by e.name), '')
    from public.entity_operations eo
    join public.entities e on e.id = eo.entity_id
   where eo.operation_id = op and eo.slot = s
$fn$;

-- Reescreve os campos antigos a partir das entidades ligadas — só no dossiê já
-- convertido. No que ainda não foi, o texto original fica intacto.
create or replace function public.espelha_envolvidos(op uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare convertida boolean;
begin
  select entities_at is not null into convertida from public.operations where id = op;
  if not coalesce(convertida, false) then return; end if;

  update public.operations set
    f_suspects  = public.lista_slot(op, 'suspects'),
    f_agents    = public.lista_slot(op, 'agents'),
    f_witnesses = public.lista_slot(op, 'witnesses'),
    f_victims   = public.lista_slot(op, 'victims'),
    f_place     = public.lista_slot(op, 'place')
   where id = op;
end $fn$;

create or replace function public.ao_mudar_vinculo_operacao()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'UPDATE' and old.operation_id is distinct from new.operation_id then
    perform public.espelha_envolvidos(old.operation_id);
  end if;
  perform public.espelha_envolvidos(coalesce(new.operation_id, old.operation_id));
  return coalesce(new, old);
end $fn$;

drop trigger if exists entity_operations_espelho on public.entity_operations;
create trigger entity_operations_espelho
  after insert or update or delete on public.entity_operations
  for each row execute function public.ao_mudar_vinculo_operacao();

-- Renomear a entidade reescreve o espelho de todos os dossiês dela.
create or replace function public.ao_renomear_entidade()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.name is distinct from old.name then
    perform public.espelha_envolvidos(operation_id)
       from public.entity_operations where entity_id = new.id;
  end if;
  return new;
end $fn$;

drop trigger if exists entities_espelho on public.entities;
create trigger entities_espelho after update on public.entities
  for each row execute function public.ao_renomear_entidade();

-- ---------- possível duplicata ----------
-- Procura em TODO o registro, de propósito: dois cadastros para a mesma pessoa
-- quebram justamente o cruzamento que a teia existe para fazer. Por isso é
-- `security definer` — passa por cima do RLS. O que ela devolve é só nome,
-- apelido e tipo: nunca a operação onde a entidade aparece, nunca a foto, nunca
-- o resumo. Saber que um nome já está no registro não entrega investigação
-- nenhuma; dizer em qual delas, sim — e isso aqui não diz.
create or replace function public.entidades_parecidas(p_name text, p_ignore uuid default null)
returns table (id uuid, kind text, name text, aliases text[], score real)
language sql stable security definer set search_path = public as $fn$
  select c.id, c.kind, c.name, c.aliases, c.score
    from (
      select e.id, e.kind, e.name,
             coalesce(array_agg(a.alias) filter (where a.alias is not null), '{}'::text[]) as aliases,
             greatest(
               extensions.similarity(lower(e.name), lower(btrim(p_name))),
               coalesce(max(extensions.similarity(lower(a.alias), lower(btrim(p_name)))), 0)
             )::real as score
        from public.entities e
        left join public.entity_aliases a on a.entity_id = e.id
       where btrim(coalesce(p_name, '')) <> ''
         and (p_ignore is null or e.id <> p_ignore)
       group by e.id, e.kind, e.name
    ) c
   where c.score >= 0.42
   order by c.score desc, c.name
   limit 8
$fn$;

-- `security definer` passa por cima do RLS, então quem pode chamar importa:
-- sem isto, a chave `anon` que vive no config.js varreria o registro inteiro
-- sem sequer entrar no site.
revoke execute on function public.entidades_parecidas(text, uuid) from public, anon;
grant  execute on function public.entidades_parecidas(text, uuid) to authenticated;

-- Estas duas só são chamadas por gatilho; ninguém precisa alcançá-las de fora.
revoke execute on function public.lista_slot(uuid, text)       from public, anon, authenticated;
revoke execute on function public.espelha_envolvidos(uuid)     from public, anon, authenticated;

-- ---------- fotos das entidades ----------
-- Bucket próprio: a policy de `operacoes` casa o primeiro pedaço do caminho com
-- operations.id, e uma foto de entidade nunca casaria ali.
insert into storage.buckets (id, name, public)
  values ('entidades', 'entidades', false)
  on conflict (id) do nothing;

drop policy if exists ent_anexo_read   on storage.objects;
drop policy if exists ent_anexo_insert on storage.objects;
drop policy if exists ent_anexo_delete on storage.objects;

create policy ent_anexo_read on storage.objects for select to authenticated
using (
  bucket_id = 'entidades'
  and public.can_see_entity(public.uuid_ou_nulo(split_part(name, '/', 1)))
);

-- A foto sobe antes de a entidade existir, então aqui basta ser o dono.
create policy ent_anexo_insert on storage.objects for insert to authenticated
with check (bucket_id = 'entidades' and owner = auth.uid());

create policy ent_anexo_delete on storage.objects for delete to authenticated
using (bucket_id = 'entidades' and (owner = auth.uid() or public.is_staff()));

-- ---------- RLS ----------
alter table public.entities          enable row level security;
alter table public.entity_aliases    enable row level security;
alter table public.entity_operations enable row level security;

do $do$
declare t text; p text;
begin
  foreach t in array array['entities','entity_aliases','entity_operations'] loop
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p, t);
    end loop;
  end loop;
end $do$;

create policy ent_read   on public.entities for select to authenticated
  using (public.can_see_entity(id));
create policy ent_insert on public.entities for insert to authenticated
  with check (created_by = auth.uid());
create policy ent_update on public.entities for update to authenticated
  using (public.can_see_entity(id)) with check (public.can_see_entity(id));
create policy ent_delete on public.entities for delete to authenticated
  using (public.can_see_entity(id) and (created_by = auth.uid() or public.is_staff()));

create policy enta_read  on public.entity_aliases for select to authenticated
  using (public.can_see_entity(entity_id));
create policy enta_write on public.entity_aliases for all to authenticated
  using (public.can_see_entity(entity_id)) with check (public.can_see_entity(entity_id));

-- Esta é a parede que esconde o "também aparece em TROIA": a ligação só é
-- legível para quem alcança o canal daquela operação. Quem não alcança enxerga
-- a entidade, mas não as operações alheias dela.
create policy ento_read on public.entity_operations for select to authenticated
  using (exists (select 1 from public.operations o
                  where o.id = operation_id and public.can_read_channel(o.channel)));
-- `channel like 'chan:%'` é a regra "agente não cria teia" escrita onde ela
-- vale de verdade. O outro prefixo, `agent:<id>`, é o espaço privado entre um
-- agente e o comando — anotação pessoal, não investigação. Se uma entidade
-- pudesse morar lá, o gatilho de detecção chamaria `leitores_do_canal` nesse
-- canal, que devolve o agente MAIS todo o comando: um dossiê pessoal avisaria
-- a chefia inteira de uma conexão. Esconder o botão na tela não resolveria.
create policy ento_insert on public.entity_operations for insert to authenticated
  with check (created_by = auth.uid()
              and exists (select 1 from public.operations o
                           where o.id = operation_id
                             and o.channel like 'chan:%'
                             and public.can_read_channel(o.channel)));
create policy ento_update on public.entity_operations for update to authenticated
  using (exists (select 1 from public.operations o
                  where o.id = operation_id and public.can_read_channel(o.channel)))
  with check (exists (select 1 from public.operations o
                       where o.id = operation_id and public.can_read_channel(o.channel)));
create policy ento_delete on public.entity_operations for delete to authenticated
  using (exists (select 1 from public.operations o
                  where o.id = operation_id and public.can_read_channel(o.channel)));


-- ----------------------------------------------------------------------------
-- O GRAFO
-- ----------------------------------------------------------------------------
-- O nó da teia é de dois tipos: a entidade (acima) e a própria operação, que
-- continua sendo a linha de `operations` — não existe cópia dela aqui. Por isso
-- a ponta de um vínculo é um par (tipo, id) em vez de chave estrangeira: dá
-- para ligar entidade a entidade, entidade a operação e operação a operação com
-- uma tabela só, e o sigilo de cada ponta continua sendo o da tabela de origem.
--
-- O nó FUKUROU, o centro da Teia Geral, não está em tabela nenhuma: ele é
-- montado na tela. Gravá-lo exigiria dar acesso de leitura a ele para todo
-- mundo, e um nó que todos enxergam é exatamente o que esta feature não quer.

-- Resolve a ponta: cada tipo de nó pergunta ao seu próprio dono de sigilo.
create or replace function public.can_see_node(k text, i uuid)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
begin
  if i is null then return false; end if;
  if k = 'ent' then return public.can_see_entity(i); end if;
  if k = 'op'  then
    return exists (select 1 from public.operations o
                    where o.id = i and public.can_read_channel(o.channel));
  end if;
  return false;
end $fn$;

-- ---------- vínculos ----------
create table if not exists public.links (
  id         uuid primary key default gen_random_uuid(),
  a_kind     text not null,
  a_id       uuid not null,
  b_kind     text not null,
  b_id       uuid not null,
  type       text not null default 'outro',
  label      text not null default '',
  confidence text not null default 'provavel',
  note       text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.links drop constraint if exists links_kind_check;
alter table public.links add constraint links_kind_check
  check (a_kind in ('ent','op') and b_kind in ('ent','op'));

alter table public.links drop constraint if exists links_type_check;
alter table public.links add constraint links_type_check
  check (type in ('comando','familia','local','financeiro','social','outro'));

alter table public.links drop constraint if exists links_conf_check;
alter table public.links add constraint links_conf_check
  check (confidence in ('confirmado','provavel','suposto'));

-- Um nó não se liga a si mesmo, e o mesmo par não entra duas vezes. O site
-- grava sempre na mesma ordem (ver `ordena` em teia.js) para esta unicidade
-- valer de verdade.
alter table public.links drop constraint if exists links_sem_laco;
alter table public.links add constraint links_sem_laco
  check (not (a_kind = b_kind and a_id = b_id));

create unique index if not exists links_par_idx
  on public.links (a_kind, a_id, b_kind, b_id);
create index if not exists links_a_idx on public.links (a_kind, a_id);
create index if not exists links_b_idx on public.links (b_kind, b_id);

drop trigger if exists links_touch on public.links;
create trigger links_touch before update on public.links
  for each row execute function public.touch_updated_at();

-- ---------- posição dos nós ----------
-- A teia é um quadro de investigação: onde cada nó foi parar é informação, e
-- vale para todo mundo que abre a mesma aba — como a ordem da barra lateral.
create table if not exists public.node_positions (
  view_key   text not null,            -- 'geral' ou 'op:<uuid>'
  node_kind  text not null,
  node_id    uuid not null,
  x          double precision not null,
  y          double precision not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (view_key, node_kind, node_id)
);

-- ---------- quem entra na Teia Geral ----------
-- A teia individual de uma operação segue o sigilo do canal dela: quem lê o
-- canal, abre a aba. A Teia Geral é outra coisa — ela mostra de uma vez o
-- desenho de todas as investigações que o agente alcança, e isso é um poder
-- à parte. ADMIN e MASTER têm sempre; os demais, só por concessão, feita
-- dentro da própria página do grafo.
--
-- A concessão abre a porta, não derruba a parede: lá dentro o RLS continua
-- valendo nó por nó, e quem entra vê só o que já alcançava pelos canais.
create table if not exists public.teia_geral_access (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.can_see_teia_geral()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_admin()
      or exists (select 1 from public.teia_geral_access where profile_id = auth.uid())
$fn$;

-- A aba a que uma posição pertence: 'geral' ou 'op:<uuid>'.
create or replace function public.can_see_view(v text)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare alvo uuid;
begin
  if v = 'geral' then return public.can_see_teia_geral(); end if;
  if v like 'op:%' then
    alvo := public.uuid_ou_nulo(substring(v from 4));
    if alvo is null then return false; end if;
    return exists (select 1 from public.operations o
                    where o.id = alvo and public.can_read_channel(o.channel));
  end if;
  return false;
end $fn$;

-- ---------- faxina ----------
-- Vínculo não tem chave estrangeira (a ponta é polimórfica), então quem apaga
-- as sobras é gatilho. Sem isto, apagar uma operação deixaria aresta solta
-- apontando para um nó que não existe mais.
create or replace function public.limpa_no()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare k text := tg_argv[0];
begin
  delete from public.links
   where (a_kind = k and a_id = old.id) or (b_kind = k and b_id = old.id);
  delete from public.node_positions where node_kind = k and node_id = old.id;
  return old;
end $fn$;

drop trigger if exists entities_limpa_no on public.entities;
create trigger entities_limpa_no after delete on public.entities
  for each row execute function public.limpa_no('ent');

drop trigger if exists operations_limpa_no on public.operations;
create trigger operations_limpa_no after delete on public.operations
  for each row execute function public.limpa_no('op');

-- Apagada a operação, a aba individual dela some — e com ela as posições que
-- só faziam sentido naquela aba.
create or replace function public.limpa_aba_da_operacao()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  delete from public.node_positions where view_key = 'op:' || old.id::text;
  return old;
end $fn$;

drop trigger if exists operations_limpa_aba on public.operations;
create trigger operations_limpa_aba after delete on public.operations
  for each row execute function public.limpa_aba_da_operacao();

-- ---------- RLS do grafo ----------
alter table public.links             enable row level security;
alter table public.node_positions    enable row level security;
alter table public.teia_geral_access enable row level security;

do $do$
declare t text; p text;
begin
  foreach t in array array['links','node_positions','teia_geral_access'] loop
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p, t);
    end loop;
  end loop;
end $do$;

-- As DUAS pontas precisam ser visíveis. É esta linha que impede descobrir uma
-- operação sigilosa pela aresta que chega nela: sem acesso à outra ponta, o
-- vínculo simplesmente não existe para quem está olhando.
create policy link_read on public.links for select to authenticated
  using (public.can_see_node(a_kind, a_id) and public.can_see_node(b_kind, b_id));
create policy link_insert on public.links for insert to authenticated
  with check (created_by = auth.uid()
              and public.can_see_node(a_kind, a_id) and public.can_see_node(b_kind, b_id));
create policy link_update on public.links for update to authenticated
  using (public.can_see_node(a_kind, a_id) and public.can_see_node(b_kind, b_id))
  with check (public.can_see_node(a_kind, a_id) and public.can_see_node(b_kind, b_id));
create policy link_delete on public.links for delete to authenticated
  using (public.can_see_node(a_kind, a_id) and public.can_see_node(b_kind, b_id)
         and (created_by = auth.uid() or public.is_staff()));

-- Ver o nó não basta: a ABA também tem dono. Sem esta segunda metade, uma
-- linha de posição de um nó que o agente alcança, gravada na aba de uma
-- operação sigilosa, entregaria o id daquela operação pelo `view_key`.
create policy pos_read  on public.node_positions for select to authenticated
  using (public.can_see_view(view_key) and public.can_see_node(node_kind, node_id));
create policy pos_write on public.node_positions for all to authenticated
  using (public.can_see_view(view_key) and public.can_see_node(node_kind, node_id))
  with check (public.can_see_view(view_key) and public.can_see_node(node_kind, node_id));

-- O agente enxerga a própria linha — é assim que o site sabe se mostra ou não
-- a entrada da Teia Geral na barra. A lista inteira, só o ADMIN vê.
create policy teia_acc_read  on public.teia_geral_access for select to authenticated
  using (public.is_admin() or profile_id = auth.uid());
create policy teia_acc_write on public.teia_geral_access for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ----------------------------------------------------------------------------
-- CONEXÕES DETECTADAS E AVISOS
-- ----------------------------------------------------------------------------
-- Quando a mesma entidade passa a estar ligada a duas operações, as duas
-- investigações se tocam. A Teia Geral mostra isso sozinha (a entidade vira nó
-- com aresta para cada operação, ver teia.js), e aqui nasce o aviso para quem
-- precisa saber.
--
-- O QUE O AVISO NÃO DIZ: nome da entidade, nome da operação, foto, resumo. A
-- linha guarda `entity_id` — que o destinatário já podia ver, porque ele
-- alcança alguma operação dela — e um `pair_key`, que é o md5 do par de
-- operações. O hash existe só para o mesmo aviso não sair duas vezes; ele não
-- entrega id de operação nenhuma. Guardar os dois ids aqui seria entregar a
-- existência da operação sigilosa a quem não a alcança, que é justamente o que
-- o aviso foi desenhado para não fazer.

create table if not exists public.notices (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind       text not null default 'conexao',
  entity_id  uuid references public.entities(id) on delete cascade,
  pair_key   text not null default '',
  seen_at    timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists notices_unico_idx
  on public.notices (profile_id, kind, entity_id, pair_key);
create index if not exists notices_dono_idx
  on public.notices (profile_id, created_at desc);

-- ---------- o estado da conexão ----------
-- Quem alcança as DUAS operações pode confirmar, ignorar ou anotar o que achou.
-- Quem alcança só uma recebe o aviso, mas não resolve a conexão: resolver exige
-- enxergar os dois lados.
create table if not exists public.auto_connections (
  entity_id  uuid not null references public.entities(id) on delete cascade,
  op_a       uuid not null references public.operations(id) on delete cascade,
  op_b       uuid not null references public.operations(id) on delete cascade,
  state      text not null default 'nova',
  note       text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (entity_id, op_a, op_b)
);

alter table public.auto_connections drop constraint if exists auto_connections_state_check;
alter table public.auto_connections add constraint auto_connections_state_check
  check (state in ('nova','confirmada','ignorada'));

-- ---------- a detecção ----------
-- Dispara ao vincular uma entidade a uma operação — que é o momento em que o
-- dossiê é salvo. Para cada operação que a entidade JÁ tinha, nasce um par.
-- Entrando uma terceira operação, só os pares novos dela são avisados: os
-- antigos já têm linha e o índice único os barra.
create or replace function public.detecta_conexao()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  canal_novo text;
  outra      record;
  chave      text;
  autor      uuid := auth.uid();
begin
  select channel into canal_novo from public.operations where id = new.operation_id;
  if canal_novo is null then return new; end if;

  for outra in
    select eo.operation_id as id, o.channel
      from public.entity_operations eo
      join public.operations o on o.id = eo.operation_id
     where eo.entity_id = new.entity_id
       and eo.operation_id <> new.operation_id
  loop
    chave := md5(least(new.operation_id::text, outra.id::text) ||
                 greatest(new.operation_id::text, outra.id::text));

    insert into public.auto_connections (entity_id, op_a, op_b)
    values (new.entity_id,
            least(new.operation_id, outra.id),
            greatest(new.operation_id, outra.id))
    on conflict do nothing;

    -- Vai para quem alcança QUALQUER uma das duas operações: para esse agente
    -- a conexão é novidade, mesmo que ele só enxergue um dos lados. Quem
    -- acabou de criar o vínculo não é avisado — ele já viu acontecer.
    insert into public.notices (profile_id, kind, entity_id, pair_key)
    select q.p, 'conexao', new.entity_id, chave
      from (select p from public.leitores_do_canal(canal_novo) p
            union
            select p from public.leitores_do_canal(outra.channel) p) q
     where q.p is not null
       and (autor is null or q.p <> autor)
    on conflict do nothing;
  end loop;

  return new;
end $fn$;

drop trigger if exists entity_operations_detecta on public.entity_operations;
create trigger entity_operations_detecta
  after insert on public.entity_operations
  for each row execute function public.detecta_conexao();

-- Desfeito o vínculo, a conexão daquele par deixa de existir. A aresta some
-- sozinha da Teia Geral (ela é derivada), e aqui some o estado dela. O aviso
-- já dado fica: ele é histórico do que foi visto, não o estado atual.
create or replace function public.desfaz_conexao()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  delete from public.auto_connections
   where entity_id = old.entity_id
     and (op_a = old.operation_id or op_b = old.operation_id);
  return old;
end $fn$;

drop trigger if exists entity_operations_desfaz on public.entity_operations;
create trigger entity_operations_desfaz
  after delete on public.entity_operations
  for each row execute function public.desfaz_conexao();

-- ---------- RLS dos avisos ----------
alter table public.notices          enable row level security;
alter table public.auto_connections enable row level security;

do $do$
declare t text; p text;
begin
  foreach t in array array['notices','auto_connections'] loop
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p, t);
    end loop;
  end loop;
end $do$;

-- O aviso é de quem recebeu, e de mais ninguém. Nem o ADMIN lê a caixa alheia.
create policy aviso_read   on public.notices for select to authenticated
  using (profile_id = auth.uid());
create policy aviso_update on public.notices for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy aviso_delete on public.notices for delete to authenticated
  using (profile_id = auth.uid());
-- Ninguém escreve aviso pelo site: quem insere é o gatilho, como definer.

create policy conex_read on public.auto_connections for select to authenticated
  using (exists (select 1 from public.operations o
                  where o.id = op_a and public.can_read_channel(o.channel))
     and exists (select 1 from public.operations o
                  where o.id = op_b and public.can_read_channel(o.channel)));
create policy conex_update on public.auto_connections for update to authenticated
  using (exists (select 1 from public.operations o
                  where o.id = op_a and public.can_read_channel(o.channel))
     and exists (select 1 from public.operations o
                  where o.id = op_b and public.can_read_channel(o.channel)))
  with check (exists (select 1 from public.operations o
                       where o.id = op_a and public.can_read_channel(o.channel))
          and exists (select 1 from public.operations o
                       where o.id = op_b and public.can_read_channel(o.channel)));

-- ============================================================================
-- 8. REALTIME
-- ============================================================================
do $do$
declare t text;
begin
  foreach t in array array['profiles','messages','categories','channels',
                           'category_members','channel_members',
                           'operations','operation_entries','sidebar_order',
                           'fukurou_chats','fukurou_msgs',
                           'entities','entity_aliases','entity_operations',
                           'links','node_positions','teia_geral_access',
                           'notices','auto_connections']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
             when undefined_object  then null;
    end;
  end loop;
end $do$;

-- DELETE em tempo real precisa da linha antiga completa
alter table public.profiles          replica identity full;
alter table public.channels          replica identity full;
alter table public.categories        replica identity full;
alter table public.messages          replica identity full;
alter table public.operations        replica identity full;
alter table public.operation_entries replica identity full;
alter table public.sidebar_order     replica identity full;
alter table public.entities          replica identity full;
alter table public.entity_aliases    replica identity full;
alter table public.entity_operations replica identity full;
alter table public.links             replica identity full;
alter table public.node_positions    replica identity full;
alter table public.teia_geral_access replica identity full;
alter table public.notices           replica identity full;
alter table public.auto_connections  replica identity full;

-- ============================================================================
-- 9. RECARGA DO CACHE
-- ============================================================================
-- O PostgREST guarda um retrato do schema; sem este aviso, uma tabela ou
-- função recém-criada pode demorar a aparecer para o site, com o erro
-- "Could not find the table ... in the schema cache".
notify pgrst, 'reload schema';

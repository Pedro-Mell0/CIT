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
  check (role in ('agent','command','admin'));
alter table public.invite_codes add constraint invite_codes_role_check
  check (role in ('agent','command','admin'));

insert into public.invite_codes (code, role) values
  ('AGENTE',     'agent'),
  ('COMANDOCIT', 'command'),
  ('ADMIN!@#',   'admin')
on conflict (code) do nothing;

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

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('command','admin'), false)
$fn$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'admin', false)
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

-- ============================================================================
-- 3. CADASTRO DE NOVOS AGENTES
-- ============================================================================
-- O cargo vem do código de acesso digitado no cadastro; nunca do cliente.
-- `cit.new_role` só é definido por admin_create_user(), dentro da transação.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r text; cn text;
begin
  cn := coalesce(nullif(new.raw_user_meta_data->>'codename',''), split_part(new.email,'@',1));
  r  := nullif(current_setting('cit.new_role', true), '');
  if r is null then
    select role into r from public.invite_codes
      where code = new.raw_user_meta_data->>'code';
  end if;
  if r is null then
    raise exception 'Código de acesso inválido.';
  end if;
  insert into public.profiles (id, codename, role, color)
    values (new.id, cn, r, public.cor_livre());
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

-- ADMIN concede/remove privilégio de comando.
create or replace function public.set_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then
    raise exception 'Apenas o ADMIN pode alterar privilégios.';
  end if;
  if new_role not in ('agent','command','admin') then
    raise exception 'Cargo inválido.';
  end if;
  if target = auth.uid() and new_role <> 'admin' then
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

-- ADMIN troca a cor de qualquer conta.
create or replace function public.admin_set_color(target uuid, new_color text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then
    raise exception 'Apenas o ADMIN pode alterar a cor de outra conta.';
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

-- limpa policies antigas (inclusive as de versões anteriores do projeto)
do $do$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
     where schemaname = 'public'
       and tablename in ('profiles','invite_codes','categories','category_members',
                         'category_locks','channels','channel_members','channel_locks',
                         'messages','operations','operation_entries','sidebar_order')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $do$;

-- ---------- profiles ----------
create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

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
-- 6. REALTIME
-- ============================================================================
do $do$
declare t text;
begin
  foreach t in array array['profiles','messages','categories','channels',
                           'category_members','channel_members',
                           'operations','operation_entries','sidebar_order']
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

-- ============================================================================
-- 7. RECARGA DO CACHE
-- ============================================================================
-- O PostgREST guarda um retrato do schema; sem este aviso, uma tabela ou
-- função recém-criada pode demorar a aparecer para o site, com o erro
-- "Could not find the table ... in the schema cache".
notify pgrst, 'reload schema';

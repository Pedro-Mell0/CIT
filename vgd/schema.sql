-- ============================================================================
-- VGD · Vanguarda — schema completo
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode.
-- É idempotente: pode ser rodado de novo a cada atualização do site,
-- sem apagar perfis, informes ou provas já existentes.
--
-- Banco próprio, separado do CIT. Nada aqui conversa com aquele projeto.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- 1. IDENTIDADE
-- ============================================================================
-- Ao contrário do CIT, aqui não existe codinome: o oficial da Vanguarda é
-- conhecido pelo nome do personagem no RP. O nome é o que aparece no mural e
-- nas listas, e é dele que sai o login.

-- `handle` é o nome reduzido a letras, números e pontos — é a parte local do
-- e-mail interno com que a conta entra. O site calcula o mesmo valor em
-- JavaScript antes de chamar o login, então as duas contas têm de bater
-- caractere por caractere: mexer aqui exige mexer em `handleDe()`, no app.js.
create or replace function public.handle_do_nome(p text)
returns text language sql immutable as $fn$
  select btrim(regexp_replace(
           lower(translate(coalesce(p, ''),
             'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
             'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
           '[^a-z0-9]+', '.', 'g'), '.')
$fn$;

create or replace function public.email_do_handle(h text)
returns text language sql immutable as $fn$
  select h || '.vgd.vanguarda@gmail.com'
$fn$;

-- ---------- perfis ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  name       text not null,
  handle     text not null,
  role       text not null default 'candidato',
  color      text,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_name_idx   on public.profiles (lower(name));
create unique index if not exists profiles_handle_idx on public.profiles (handle);

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('candidato','oficial','comando','admin'));

alter table public.profiles drop constraint if exists profiles_color_check;
alter table public.profiles add constraint profiles_color_check
  check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

-- ---------- cor de cada oficial ----------
-- Paleta de farol e lataria: âmbar, brasa, xênon, lima. A cor identifica o
-- nome no mural; cada conta nova recebe a menos usada, para dois oficiais não
-- nascerem iguais.
create or replace function public.vgd_paleta()
returns text[] language sql immutable as $fn$
  select array[
    '#ff9d2e','#ff5c1a','#4ad9ff','#b6ff3a','#ffd166','#ff3b5c','#7ae7ff','#ffae00',
    '#ff7847','#e0ff4f','#36c9ff','#ff4fa3','#ffc14d','#9dff6b','#5ea8ff','#ff6b35'
  ]
$fn$;

/** A cor da paleta que menos gente está usando; empate vai pela ordem dela. */
create or replace function public.cor_livre()
returns text language plpgsql stable security definer set search_path = public as $fn$
declare pal text[] := public.vgd_paleta(); escolhida text;
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
-- Os códigos NÃO ficam neste arquivo. Ele é versionado num repositório
-- público, e um código escrito aqui é um código entregue: quem ler o repo
-- cria conta com o cargo que quiser. Eles vivem só no banco.
--
-- Definir ou trocar, no SQL Editor:
--   insert into public.invite_codes (code, role) values ('...', 'candidato')
--     on conflict (code) do update set role = excluded.role;
--   update public.invite_codes set code = '...' where role = 'comando';
--   delete from public.invite_codes where code = '...';   -- aposenta o antigo
create table if not exists public.invite_codes (
  code text primary key,
  role text not null
);
alter table public.invite_codes drop constraint if exists invite_codes_role_check;
alter table public.invite_codes add constraint invite_codes_role_check
  check (role in ('candidato','oficial','comando','admin'));

-- Só numa instalação nova, com a tabela ainda vazia: nasce um código de ADMIN
-- aleatório para dar a primeira conta, já que sem ADMIN ninguém cria as outras.
-- Leia-o uma vez e troque por um seu:
--   select code from public.invite_codes where role = 'admin';
insert into public.invite_codes (code, role)
select upper(encode(extensions.gen_random_bytes(6), 'hex')), 'admin'
 where not exists (select 1 from public.invite_codes);

-- ============================================================================
-- 2. INFORMES: CATEGORIAS, CANAIS E MURAL
-- ============================================================================
-- Não existe canal individual por oficial: a Vanguarda se comunica por mural e
-- por canais temáticos, criados pelo comando.

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  everyone   boolean not null default false,
  locked     boolean not null default false,
  position   int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.category_members (
  category_id uuid not null references public.categories(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id)  on delete cascade,
  primary key (category_id, profile_id)
);

create table if not exists public.channels (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  topic          text default '',
  category_id    uuid references public.categories(id) on delete set null,
  inherit_access boolean not null default true,
  everyone       boolean not null default false,
  locked         boolean not null default false,
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
-- entra, seja OFICIAL, COMANDO ou ADMIN. `locked` é só o aviso de que existe
-- trava; o código em si fica hasheado nas tabelas abaixo, que o site nunca lê
-- — só compara por verify_*_code().
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

-- ---------- cargos ----------
-- Etiqueta nomeada que o ADMIN pendura nas contas: Instrutor, Patrulheiro,
-- Comandante de turno, o que a unidade quiser. Não é a mesma coisa que
-- `profiles.role`, que é a escada de permissão do site (candidato → oficial →
-- comando → admin) e continua mandando no que cada um PODE fazer. O cargo
-- manda em ONDE se entra: um canal pode ser liberado para um cargo inteiro, e
-- aí entra quem o tiver, sem lista de nome por nome.
create table if not exists public.cargos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  cor        text,
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists cargos_nome_idx on public.cargos (lower(nome));
alter table public.cargos drop constraint if exists cargos_cor_check;
alter table public.cargos add constraint cargos_cor_check
  check (cor is null or cor ~ '^#[0-9a-fA-F]{6}$');

create table if not exists public.cargo_membros (
  cargo_id   uuid not null references public.cargos(id)   on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (cargo_id, profile_id)
);

create table if not exists public.category_cargos (
  category_id uuid not null references public.categories(id) on delete cascade,
  cargo_id    uuid not null references public.cargos(id)     on delete cascade,
  primary key (category_id, cargo_id)
);

create table if not exists public.channel_cargos (
  channel_id uuid not null references public.channels(id) on delete cascade,
  cargo_id   uuid not null references public.cargos(id)   on delete cascade,
  primary key (channel_id, cargo_id)
);

-- ---------- ordem da barra lateral ----------
-- Vale para todos: quem tem COMANDO arrasta e reorganiza para a unidade
-- inteira. `key` é 'mural', 'cat:<uuid>' ou 'chan:<uuid>'.
create table if not exists public.sidebar_order (
  key      text primary key,
  position int not null default 0
);

-- ---------- mensagens ----------
-- `channel` é uma chave de texto:
--   'mural'          quadro de avisos, aberto a todo oficial
--   'chan:<uuid>'    canal criado pelo comando (tabela channels)
create table if not exists public.messages (
  id         bigint generated by default as identity primary key,
  channel    text not null,
  author_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null,
  edited_at  timestamptz,
  edited_by  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists messages_channel_idx on public.messages (channel, created_at);

-- ============================================================================
-- 3. PROVA DA VANGUARDA
-- ============================================================================

-- Linha única de configuração. O CHECK em `id` garante que ela seja única.
create table if not exists public.exam_config (
  id          boolean primary key default true,
  intro       text not null default
    'Prova de admissão da Unidade Vanguarda. Leia cada questão com calma: não há tempo cronometrado, mas só existe uma tentativa — uma nova só com liberação do comando.',
  min_percent int not null default 70,
  updated_at  timestamptz not null default now(),
  constraint exam_config_linha_unica check (id)
);
insert into public.exam_config (id) values (true) on conflict (id) do nothing;

-- `correct` é o gabarito e mora só aqui. A tabela inteira é invisível para o
-- candidato (ver RLS); ele enxerga as questões pela view mais abaixo, que não
-- traz essa coluna.
create table if not exists public.exam_questions (
  id         uuid primary key default gen_random_uuid(),
  position   int not null default 0,
  kind       text not null default 'objetiva',
  prompt     text not null,
  options    jsonb not null default '[]'::jsonb,   -- [{"id":"a","text":"..."}]
  correct    text,
  points     int not null default 1,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
-- A questão ABERTA é respondida por escrito e corrigida sozinha, por critérios.
-- `rubrica` é a lista deles, cada um com um peso e uma expressão regular:
--   [{"pontos":1,"rotulo":"abertura QAP Central","re":"qap\\s*central"}]
-- É a tradução do que o PDF do curso descreve em prosa ("abertura QAP Central,
-- 1; unidade correta, 1; ..."). Mora na mesma tabela do gabarito e, como ela, é
-- invisível para quem faz a prova: a view pública não traz esta coluna.
alter table public.exam_questions add column if not exists rubrica jsonb not null default '[]'::jsonb;

-- Identidade estável das questões que vêm do curso (ver curso.sql): é por ela
-- que o arquivo de conteúdo pode ser rodado de novo sem duplicar a prova.
-- Questão criada à mão pelo painel não tem chave.
-- Índice unique simples, e não parcial: `on conflict (chave)` só casa com um
-- índice parcial se a cláusula WHERE dele for repetida na instrução, e o
-- Postgres já deixa conviver quantos NULL quiser num unique comum — que é
-- exatamente o que as questões criadas à mão precisam.
drop index if exists public.exam_questions_chave_idx;
alter table public.exam_questions add column if not exists chave text;
create unique index if not exists exam_questions_chave_idx on public.exam_questions (chave);

alter table public.exam_questions drop constraint if exists exam_questions_kind_check;
alter table public.exam_questions add constraint exam_questions_kind_check
  check (kind in ('objetiva','dissertativa','aberta'));
alter table public.exam_questions drop constraint if exists exam_questions_points_check;
alter table public.exam_questions add constraint exam_questions_points_check
  check (points between 1 and 100);

-- O que o candidato pode ver: tudo menos o gabarito.
-- `security_invoker = off` é o ponto inteiro desta view: ela roda com os
-- poderes do dono e, por isso, enxerga a tabela apesar do RLS que barra o
-- candidato lá. É assim que ele recebe as questões sem alcançar `correct`.
drop view if exists public.exam_questions_public;
create view public.exam_questions_public as
  select id, position, kind, prompt, options, points
    from public.exam_questions
   where active;
-- `security_invoker = off` já é o padrão; declarar é só deixar a intenção
-- escrita. Vai num bloco próprio porque a opção só existe do Postgres 15 em
-- diante, e um banco mais antigo recusaria o arquivo inteiro por causa dela.
do $do$
begin
  execute 'alter view public.exam_questions_public set (security_invoker = off)';
exception when others then null;
end $do$;

grant select on public.exam_questions_public to authenticated;

create table if not exists public.exam_attempts (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'em_andamento',
  pontos_obj   int not null default 0,
  pontos_dis   int not null default 0,
  pontos_max   int not null default 0,
  nota         numeric(5,2),
  parecer      text not null default '',
  arquivada    boolean not null default false,
  started_at   timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.profiles(id) on delete set null
);
alter table public.exam_attempts drop constraint if exists exam_attempts_status_check;
alter table public.exam_attempts add constraint exam_attempts_status_check
  check (status in ('em_andamento','aguardando','aprovado','reprovado'));
create index if not exists exam_attempts_perfil_idx on public.exam_attempts (profile_id, started_at desc);
create index if not exists exam_attempts_status_idx on public.exam_attempts (status, submitted_at);

create table if not exists public.exam_answers (
  attempt_id  uuid not null references public.exam_attempts(id)  on delete cascade,
  question_id uuid not null references public.exam_questions(id) on delete cascade,
  escolha     text,
  texto       text not null default '',
  certa       boolean,
  pontos      int not null default 0,
  primary key (attempt_id, question_id)
);
-- O que cada critério da rubrica rendeu, para quem corrige ver a conta aberta
-- em vez de um número solto: [{"rotulo":"QTI","pontos":1,"bateu":true}]
alter table public.exam_answers add column if not exists criterios jsonb not null default '[]'::jsonb;

-- ---------- registro que sobrevive à conta ----------
-- Reprovar apaga a conta do candidato, e com ela a tentativa e as respostas.
-- Sem este registro, a unidade perderia a memória de quem prestou a prova e de
-- quem decidiu o quê. Aqui fica só o resumo, por isso ele não cai na cascata.
create table if not exists public.exam_log (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  nota        numeric(5,2),
  pontos      int not null default 0,
  pontos_max  int not null default 0,
  veredito    text not null,
  parecer     text not null default '',
  removido    boolean not null default false,
  decidido_por text,
  decidido_em timestamptz not null default now()
);
create index if not exists exam_log_data_idx on public.exam_log (decidido_em desc);

-- ============================================================================
-- 4. FUNÇÕES DE APOIO
-- ============================================================================
-- As policies saem de cena ANTES das funções serem redefinidas. Uma policy que
-- usa `category_visible(uuid, boolean, uuid)` é uma dependência da função: com
-- ela de pé, o DROP da assinatura antiga falha e o arquivo inteiro para no
-- meio. Elas são todas recriadas na seção 8, logo abaixo.
do $do$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
     where schemaname = 'public'
       and tablename in ('profiles','invite_codes','categories','category_members',
                         'category_locks','channels','channel_members','channel_locks',
                         'messages','sidebar_order','exam_config','exam_questions',
                         'exam_attempts','exam_answers','exam_log',
                         'cargos','cargo_membros','category_cargos','channel_cargos')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $do$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $fn$
  select role from public.profiles where id = auth.uid()
$fn$;

/** COMANDO e ADMIN: corrigem prova, criam canais, editam mensagem alheia. */
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('comando','admin'), false)
$fn$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'admin', false)
$fn$;

/** Quem já passou na prova. É a porta dos informes: candidato não entra. */
create or replace function public.is_oficial()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('oficial','comando','admin'), false)
$fn$;

-- ---------- porta aberta ao candidato ----------
-- O candidato precisa estudar antes de fazer a prova, e o material de estudo
-- mora em canais. `candidatos` é a chave dessa porta: marcada, a categoria ou o
-- canal passa a ser legível por qualquer conta autenticada, inclusive quem
-- ainda não foi aprovado. Como candidato é o cargo mais restrito de todos,
-- "aberto ao candidato" é o mesmo que "aberto a todo mundo".
alter table public.categories add column if not exists candidatos boolean not null default false;
alter table public.channels   add column if not exists candidatos boolean not null default false;

-- Canal de leitura: o material do curso não é lugar de conversa. Marcado, só
-- COMANDO e ADMIN publicam ali; o resto lê.
alter table public.channels add column if not exists somente_leitura boolean not null default false;

-- ---------- acesso por cargo ----------
-- Liberação nomeada: o canal é dado a um cargo, e entra quem o tiver. Vale
-- independentemente da credencial — é a ferramenta para o ADMIN abrir uma
-- exceção precisa sem precisar promover ninguém.
create or replace function public.tem_cargo_na_categoria(cat uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.category_cargos cc
      join public.cargo_membros m on m.cargo_id = cc.cargo_id
     where cc.category_id = cat and m.profile_id = auth.uid());
$fn$;

create or replace function public.tem_cargo_no_canal(cid uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.channel_cargos cc
      join public.cargo_membros m on m.cargo_id = cc.cargo_id
     where cc.channel_id = cid and m.profile_id = auth.uid());
$fn$;

create or replace function public.can_see_category(cat uuid)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare ev boolean; cnd boolean; uid uuid := auth.uid();
begin
  if uid is null or cat is null then return false; end if;
  if public.is_admin() then return true; end if;
  select everyone, candidatos into ev, cnd from public.categories where id = cat;
  if not found then return false; end if;
  if coalesce(cnd, false) then return true; end if;
  if public.tem_cargo_na_categoria(cat) then return true; end if;
  if not public.is_oficial() then return false; end if;
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
drop function if exists public.category_visible(uuid, boolean, uuid);
drop function if exists public.category_visible(uuid, boolean, boolean, uuid);
create or replace function public.category_visible(cid uuid, ev boolean, cnd boolean, autor uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_admin()
      or autor = auth.uid()
      or coalesce(cnd, false)
      or public.tem_cargo_na_categoria(cid)
      or (public.is_oficial()
          and (coalesce(ev, false)
               or exists (select 1 from public.category_members m
                           where m.category_id = cid and m.profile_id = auth.uid())));
$fn$;

drop function if exists public.channel_visible(uuid, boolean, boolean, uuid, uuid);
drop function if exists public.channel_visible(uuid, boolean, boolean, boolean, uuid, uuid);
create or replace function public.channel_visible(
  cat uuid, inh boolean, ev boolean, cnd boolean, cid uuid, autor uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_admin()
      or autor = auth.uid()
      or coalesce(cnd, false)
      or public.tem_cargo_no_canal(cid)
      -- herdando de uma categoria aberta ao candidato, o canal abre junto
      or (cat is not null and inh and public.can_see_category(cat))
      or (public.is_oficial()
          and (cat is null or not inh)
          and (coalesce(ev, false)
               or exists (select 1 from public.channel_members m
                           where m.channel_id = cid and m.profile_id = auth.uid())));
$fn$;

/** Regra única de acesso a canal, usada por todas as policies. */
create or replace function public.can_read_channel(ch text)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare
  cid uuid; cat uuid; inh boolean; ev boolean; cnd boolean; aut uuid; uid uuid := auth.uid();
begin
  if uid is null or ch is null then return false; end if;
  -- o mural é a sala da unidade: entra quem já passou na prova
  if ch = 'mural' then return public.is_oficial(); end if;
  if public.is_admin() then return true; end if;

  if ch like 'chan:%' then
    begin
      cid := substring(ch from 6)::uuid;
    exception when others then
      return false;
    end;
    select category_id, inherit_access, everyone, candidatos, created_by
      into cat, inh, ev, cnd, aut
      from public.channels where id = cid;
    if not found then return false; end if;
    return public.channel_visible(cat, inh, ev, cnd, cid, aut);
  end if;

  return false;
end $fn$;

/**
 * Quem pode publicar num canal. Ler e escrever deixaram de ser a mesma coisa
 * quando o material do curso virou canal: o candidato precisa ler as páginas
 * de teoria, e não precisa rabiscar nelas.
 */
create or replace function public.pode_escrever(ch text)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare cid uuid; so_leitura boolean;
begin
  if not public.can_read_channel(ch) then return false; end if;
  if public.is_staff() then return true; end if;
  if ch = 'mural' then return public.is_oficial(); end if;
  if ch like 'chan:%' then
    begin
      cid := substring(ch from 6)::uuid;
    exception when others then
      return false;
    end;
    select somente_leitura into so_leitura from public.channels where id = cid;
    return not coalesce(so_leitura, false);
  end if;
  return false;
end $fn$;

/** Marca a mensagem como editada e impede troca de autor/canal. */
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

-- Data da mensagem mais recente de cada canal. Serve ao aviso de não lida: o
-- site compara estas datas com a da última visita que ele guarda por conta.
-- `security invoker` é o essencial: a função roda com o RLS de quem chamou,
-- então cada um recebe apenas os canais que já podia ler.
create or replace function public.ultimas_por_canal()
returns table (channel text, ultima timestamptz)
language sql stable security invoker set search_path = public as $fn$
  select m.channel, max(m.created_at) from public.messages m group by m.channel
$fn$;

-- ============================================================================
-- 5. CADASTRO
-- ============================================================================
-- O cargo vem do código de acesso digitado no cadastro; nunca do cliente.
-- `vgd.new_role` só é definido por admin_create_user(), dentro da transação.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare r text; nm text; hd text;
begin
  nm := btrim(coalesce(new.raw_user_meta_data->>'name', ''));
  if length(nm) < 3 then
    raise exception 'Informe o nome do personagem (mínimo de 3 caracteres).';
  end if;
  hd := public.handle_do_nome(nm);
  if length(hd) < 3 then
    raise exception 'Nome do personagem inválido.';
  end if;

  r := nullif(current_setting('vgd.new_role', true), '');
  if r is null then
    select role into r from public.invite_codes
      where code = new.raw_user_meta_data->>'code';
  end if;
  if r is null then
    raise exception 'Código de acesso inválido.';
  end if;

  if exists (select 1 from public.profiles where lower(name) = lower(nm)) then
    raise exception 'Já existe um oficial com esse nome.';
  end if;

  insert into public.profiles (id, name, handle, role, color)
    values (new.id, nm, hd, r, public.cor_livre());
  return new;
end $fn$;

-- Remove qualquer gatilho de cadastro anterior (o nome pode ser outro);
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
-- 6. GERENCIAMENTO DE CONTAS (RPC)
-- ============================================================================

create or replace function public.set_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then
    raise exception 'Apenas o ADMIN pode alterar cargos.';
  end if;
  if new_role not in ('candidato','oficial','comando','admin') then
    raise exception 'Cargo inválido.';
  end if;
  if target = auth.uid() and new_role <> 'admin' then
    raise exception 'Você não pode rebaixar a própria conta.';
  end if;
  update public.profiles set role = new_role where id = target;
end $fn$;

create or replace function public.admin_create_user(
  p_name text, p_password text, p_role text default 'oficial')
returns uuid language plpgsql security definer
set search_path = public, auth, extensions as $fn$
declare uid uuid := gen_random_uuid(); hd text; mail text; nm text := btrim(p_name);
begin
  if not public.is_admin() then
    raise exception 'Apenas o ADMIN pode criar contas.';
  end if;
  if length(nm) < 3 or length(nm) > 40 then
    raise exception 'Nome do personagem: 3 a 40 caracteres.';
  end if;
  if length(p_password) < 6 then
    raise exception 'Senha: mínimo de 6 caracteres.';
  end if;
  if p_role not in ('candidato','oficial','comando','admin') then
    raise exception 'Cargo inválido.';
  end if;

  hd := public.handle_do_nome(nm);
  if length(hd) < 3 then
    raise exception 'Nome do personagem inválido.';
  end if;
  if exists (select 1 from public.profiles where lower(name) = lower(nm) or handle = hd) then
    raise exception 'Já existe um oficial com esse nome.';
  end if;

  mail := public.email_do_handle(hd);
  if exists (select 1 from auth.users where email = mail) then
    raise exception 'Já existe uma conta com esse nome.';
  end if;

  perform set_config('vgd.new_role', p_role, true);

  -- os campos de token vão como '' (e não null): o GoTrue falha ao ler null neles
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new)
  values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    mail, extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('name', nm), now(), now(),
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

  perform set_config('vgd.new_role', '', true);
  return uid;
end $fn$;

/** Troca o nome do personagem. O login sai do nome, então o e-mail interno e a
    identidade mudam junto: dali em diante a conta entra com o nome novo e a
    senha antiga. */
create or replace function public.set_name(target uuid, new_name text)
returns void language plpgsql security definer
set search_path = public, auth as $fn$
declare hd text; mail text; nm text := btrim(new_name);
begin
  if not public.is_admin() then
    raise exception 'Apenas o ADMIN pode alterar o nome de outra conta.';
  end if;
  if length(nm) < 3 or length(nm) > 40 then
    raise exception 'Nome do personagem: 3 a 40 caracteres.';
  end if;
  hd := public.handle_do_nome(nm);
  if length(hd) < 3 then
    raise exception 'Nome do personagem inválido.';
  end if;
  if exists (select 1 from public.profiles
              where (lower(name) = lower(nm) or handle = hd) and id <> target) then
    raise exception 'Já existe um oficial com esse nome.';
  end if;

  mail := public.email_do_handle(hd);
  if exists (select 1 from auth.users where email = mail and id <> target) then
    raise exception 'Já existe uma conta com esse nome.';
  end if;

  update public.profiles set name = nm, handle = hd where id = target;

  update auth.users
     set email = mail,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('name', nm),
         updated_at = now()
   where id = target;

  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb)
                         || jsonb_build_object('email', mail),
         updated_at = now()
   where user_id = target and provider = 'email';
end $fn$;

/** Cada um ajusta a própria cor. O nome do personagem não se troca sozinho:
    ele é a identidade no RP, e quem muda é o comando. */
create or replace function public.update_me(new_color text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre de novo.';
  end if;
  if new_color is null or new_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Cor inválida.';
  end if;
  update public.profiles set color = new_color where id = auth.uid();
end $fn$;

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

drop function if exists public.remove_user(uuid);
create or replace function public.remove_user(target uuid)
returns void language plpgsql security definer set search_path = public, auth as $fn$
declare r text;
begin
  select role into r from public.profiles where id = target;
  if r is null then
    raise exception 'Oficial não encontrado.';
  end if;
  if target = auth.uid() then
    raise exception 'Você não pode remover a própria conta.';
  end if;
  if public.is_admin() then
    null;
  elsif public.is_staff() and r in ('candidato','oficial') then
    null;
  else
    raise exception 'Sem permissão para remover esta conta.';
  end if;

  delete from auth.users where id = target;   -- cascata apaga perfil e provas
end $fn$;

create or replace function public.admin_delete_user(target uuid)
returns void language sql security definer set search_path = public as $fn$
  select public.remove_user(target);
$fn$;

-- ---------- trava de acesso por código ----------
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

-- ============================================================================
-- 7. PROVA (RPC)
-- ============================================================================
-- Toda a correção objetiva acontece aqui dentro, em `security definer`: é o
-- único lugar onde o gabarito é lido. O navegador nunca recebe `correct`, nem
-- mesmo depois de entregar a prova.

/** Abre uma tentativa. Só existe uma por candidato — outra exige liberação. */
create or replace function public.iniciar_prova()
returns uuid language plpgsql security definer set search_path = public as $fn$
declare uid uuid := auth.uid(); nova uuid; maxp int;
begin
  if uid is null then
    raise exception 'Sessão expirada. Entre de novo.';
  end if;
  if exists (select 1 from public.exam_attempts
              where profile_id = uid and not arquivada
                and status in ('em_andamento','aguardando','aprovado')) then
    raise exception 'Você já tem uma prova em andamento ou entregue.';
  end if;
  if exists (select 1 from public.exam_attempts
              where profile_id = uid and not arquivada and status = 'reprovado') then
    raise exception 'Sua prova foi reprovada. Uma nova tentativa depende do comando.';
  end if;
  if not exists (select 1 from public.exam_questions where active) then
    raise exception 'A prova ainda não foi montada pelo comando.';
  end if;

  select coalesce(sum(points), 0) into maxp from public.exam_questions where active;
  insert into public.exam_attempts (profile_id, pontos_max)
       values (uid, maxp)
    returning id into nova;
  return nova;
end $fn$;

/**
 * Entrega a prova. `p_respostas` é um array:
 *   [{"q":"<uuid>","escolha":"a"}, {"q":"<uuid>","texto":"..."}]
 *
 * A correção é toda automática e acontece aqui dentro, no único lugar que
 * enxerga o gabarito:
 *   · objetiva     — compara a alternativa marcada com `correct`;
 *   · aberta       — roda a rubrica da questão sobre o texto, critério por
 *                    critério, e guarda o que bateu em `criterios`;
 *   · dissertativa — fica em zero, esperando a nota de quem corrige.
 *
 * A prova sai daqui sempre como 'aguardando', mesmo com a nota já calculada:
 * a conta é automática, o veredito não. Quem decide é o ADMIN, no canal de
 * resultados, com a nota e a recomendação à frente.
 */
create or replace function public.enviar_prova(p_attempt uuid, p_respostas jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  uid uuid := auth.uid();
  t record; q record; r jsonb; c jsonb;
  obj int := 0; dis int := 0; maxp int; pct numeric;
begin
  if uid is null then
    raise exception 'Sessão expirada. Entre de novo.';
  end if;
  select * into t from public.exam_attempts where id = p_attempt;
  if not found or t.profile_id <> uid then
    raise exception 'Prova não encontrada.';
  end if;
  if t.status <> 'em_andamento' then
    raise exception 'Esta prova já foi entregue.';
  end if;

  delete from public.exam_answers where attempt_id = p_attempt;

  for q in select * from public.exam_questions where active order by position, created_at loop
    -- o alias nomeado evita a ambiguidade entre a coluna `value` devolvida
    -- pela função e o próprio nome dado à chamada
    select e.value into r
      from jsonb_array_elements(coalesce(p_respostas, '[]'::jsonb)) as e(value)
     where e.value->>'q' = q.id::text
     limit 1;

    if q.kind = 'objetiva' then
      declare esc text := nullif(btrim(coalesce(r->>'escolha', '')), '');
              ok boolean;
      begin
        ok := esc is not null and q.correct is not null and esc = q.correct;
        insert into public.exam_answers (attempt_id, question_id, escolha, certa, pontos)
             values (p_attempt, q.id, esc, ok, case when ok then q.points else 0 end);
        if ok then obj := obj + q.points; end if;
      end;

    elsif q.kind = 'aberta' then
      declare
        txt text := btrim(coalesce(r->>'texto', ''));
        ganhos int := 0; lista jsonb := '[]'::jsonb; bateu boolean;
      begin
        for c in select e.value from jsonb_array_elements(coalesce(q.rubrica, '[]'::jsonb)) as e(value) loop
          -- `~*` é a comparação por expressão regular sem diferenciar
          -- maiúsculas; texto vazio nunca bate, nem com padrão frouxo
          bateu := txt <> '' and txt ~* (c->>'re');
          if bateu then ganhos := ganhos + coalesce((c->>'pontos')::int, 0); end if;
          lista := lista || jsonb_build_array(jsonb_build_object(
            'rotulo', c->>'rotulo',
            'pontos', coalesce((c->>'pontos')::int, 0),
            'bateu', bateu));
        end loop;
        ganhos := least(ganhos, q.points);
        insert into public.exam_answers (attempt_id, question_id, texto, pontos, criterios)
             values (p_attempt, q.id, txt, ganhos, lista);
        obj := obj + ganhos;
      end;

    else
      insert into public.exam_answers (attempt_id, question_id, texto)
           values (p_attempt, q.id, btrim(coalesce(r->>'texto', '')));
    end if;
  end loop;

  select coalesce(sum(points), 0) into maxp from public.exam_questions where active;
  pct := case when maxp > 0 then round(obj::numeric * 100 / maxp, 2) else 0 end;

  update public.exam_attempts
     set status = 'aguardando', pontos_obj = obj, pontos_dis = dis,
         pontos_max = maxp, nota = pct, submitted_at = now()
   where id = p_attempt;
end $fn$;

/**
 * Veredito do ADMIN. `p_notas` é [{"q":"<uuid>","pontos":3}] e só vale para as
 * dissertativas, se houver alguma; o resto da nota já veio pronto da entrega.
 * Aprovar com nota baixa ou reprovar com nota alta é decisão de quem decide,
 * não da aritmética — a nota é recomendação.
 *
 * Aprovação promove o candidato a OFICIAL, que é o que abre o mural e os
 * canais da unidade.
 *
 * Reprovação APAGA A CONTA do candidato, por regra da unidade. Duas exceções
 * de segurança, para a função não virar uma arma: conta de ADMIN nunca é
 * removida, e ninguém remove a si mesmo. Antes de apagar, o resultado é
 * copiado para `exam_log`, que não cai na cascata — a unidade continua
 * sabendo quem prestou e quem decidiu o quê.
 */
create or replace function public.corrigir_prova(
  p_attempt uuid, p_notas jsonb, p_aprovar boolean, p_parecer text default '')
returns void language plpgsql security definer set search_path = public, auth as $fn$
declare
  t record; n jsonb; dis int := 0; obj int := 0; maxp int; pct numeric;
  alvo record; quem text; remover boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Apenas o ADMIN decide o resultado de uma prova.';
  end if;
  select * into t from public.exam_attempts where id = p_attempt;
  if not found then
    raise exception 'Prova não encontrada.';
  end if;
  if t.status = 'em_andamento' then
    raise exception 'Esta prova ainda não foi entregue.';
  end if;

  for n in select e.value from jsonb_array_elements(coalesce(p_notas, '[]'::jsonb)) as e(value) loop
    update public.exam_answers a
       set pontos = least(greatest(coalesce((n->>'pontos')::int, 0), 0), q.points),
           certa  = null
      from public.exam_questions q
     where a.attempt_id = p_attempt
       and a.question_id = (n->>'q')::uuid
       and q.id = a.question_id
       and q.kind = 'dissertativa';
  end loop;

  select coalesce(sum(a.pontos), 0) into dis
    from public.exam_answers a join public.exam_questions q on q.id = a.question_id
   where a.attempt_id = p_attempt and q.kind = 'dissertativa';
  select coalesce(sum(a.pontos), 0) into obj
    from public.exam_answers a join public.exam_questions q on q.id = a.question_id
   where a.attempt_id = p_attempt and q.kind in ('objetiva','aberta');

  maxp := greatest(t.pontos_max, 1);
  pct := round((obj + dis)::numeric * 100 / maxp, 2);

  select * into alvo from public.profiles where id = t.profile_id;
  select name into quem from public.profiles where id = auth.uid();
  -- o coalesce fecha o caso de `p_aprovar` chegar nulo: sem ele `remover`
  -- sairia nulo e o INSERT no exam_log quebraria na coluna NOT NULL
  remover := coalesce(not p_aprovar
                      and alvo.id is not null
                      and alvo.role <> 'admin'
                      and alvo.id <> auth.uid(), false);

  update public.exam_attempts
     set status = case when p_aprovar then 'aprovado' else 'reprovado' end,
         pontos_obj = obj, pontos_dis = dis, nota = pct,
         parecer = coalesce(btrim(p_parecer), ''),
         reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_attempt;

  insert into public.exam_log (nome, nota, pontos, pontos_max, veredito, parecer, removido, decidido_por)
       values (coalesce(alvo.name, '[removido]'), pct, obj + dis, maxp,
               case when p_aprovar then 'aprovado' else 'reprovado' end,
               coalesce(btrim(p_parecer), ''), remover, quem);

  if p_aprovar then
    update public.profiles set role = 'oficial'
     where id = t.profile_id and role = 'candidato';
  elsif remover then
    -- a cascata leva o perfil, a tentativa e as respostas; o exam_log fica
    delete from auth.users where id = alvo.id;
  end if;
end $fn$;

/** Libera nova tentativa: arquiva o que o candidato já fez. */
create or replace function public.liberar_nova_tentativa(target uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_staff() then
    raise exception 'Apenas COMANDO ou ADMIN liberam nova tentativa.';
  end if;
  update public.exam_attempts set arquivada = true
   where profile_id = target and not arquivada;
end $fn$;

-- ============================================================================
-- 8. RLS
-- ============================================================================
alter table public.profiles         enable row level security;
alter table public.invite_codes     enable row level security;
alter table public.categories       enable row level security;
alter table public.category_members enable row level security;
alter table public.category_locks   enable row level security;
alter table public.channels         enable row level security;
alter table public.channel_members  enable row level security;
alter table public.channel_locks    enable row level security;
alter table public.messages         enable row level security;
alter table public.sidebar_order    enable row level security;
alter table public.exam_config      enable row level security;
alter table public.exam_questions   enable row level security;
alter table public.exam_attempts    enable row level security;
alter table public.exam_answers     enable row level security;
alter table public.exam_log         enable row level security;
alter table public.cargos           enable row level security;
alter table public.cargo_membros    enable row level security;
alter table public.category_cargos  enable row level security;
alter table public.channel_cargos   enable row level security;

do $do$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
     where schemaname = 'public'
       and tablename in ('profiles','invite_codes','categories','category_members',
                         'category_locks','channels','channel_members','channel_locks',
                         'messages','sidebar_order','exam_config','exam_questions',
                         'exam_attempts','exam_answers','exam_log',
                         'cargos','cargo_membros','category_cargos','channel_cargos')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $do$;

-- ---------- perfis ----------
create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- códigos ----------
create policy codes_read  on public.invite_codes for select to authenticated using (public.is_admin());
create policy codes_write on public.invite_codes for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- ordem da barra ----------
create policy ord_read  on public.sidebar_order for select to authenticated using (public.is_oficial());
create policy ord_write on public.sidebar_order for all    to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- categorias ----------
create policy cat_read   on public.categories for select to authenticated
  using (public.category_visible(id, everyone, candidatos, created_by));
create policy cat_insert on public.categories for insert to authenticated
  with check (public.is_staff());
create policy cat_update on public.categories for update to authenticated
  using (public.is_staff() and public.category_visible(id, everyone, candidatos, created_by))
  with check (public.is_staff());
create policy cat_delete on public.categories for delete to authenticated
  using (public.is_staff() and public.category_visible(id, everyone, candidatos, created_by));

create policy catm_read  on public.category_members for select to authenticated
  using (public.can_see_category(category_id) or profile_id = auth.uid());
create policy catm_write on public.category_members for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- canais ----------
create policy ch_read   on public.channels for select to authenticated
  using (public.channel_visible(category_id, inherit_access, everyone, candidatos, id, created_by));
create policy ch_insert on public.channels for insert to authenticated
  with check (public.is_staff());
create policy ch_update on public.channels for update to authenticated
  using (public.is_staff() and public.channel_visible(category_id, inherit_access, everyone, candidatos, id, created_by))
  with check (public.is_staff());
create policy ch_delete on public.channels for delete to authenticated
  using (public.is_staff() and public.channel_visible(category_id, inherit_access, everyone, candidatos, id, created_by));

create policy chm_read  on public.channel_members for select to authenticated
  using (public.can_read_channel('chan:' || channel_id::text) or profile_id = auth.uid());
create policy chm_write on public.channel_members for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- travas ----------
-- Ninguém lê estas tabelas pelo site: quem define usa set_*_lock() e quem tenta
-- entrar usa verify_*_code().
create policy catlock_all on public.category_locks for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy chlock_all  on public.channel_locks  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- mensagens ----------
create policy msg_read   on public.messages for select to authenticated
  using (public.can_read_channel(channel));
create policy msg_insert on public.messages for insert to authenticated
  with check (author_id = auth.uid() and public.pode_escrever(channel));
create policy msg_update on public.messages for update to authenticated
  using (public.can_read_channel(channel) and (author_id = auth.uid() or public.is_staff()))
  with check (public.can_read_channel(channel));
create policy msg_delete on public.messages for delete to authenticated
  using (public.can_read_channel(channel) and (author_id = auth.uid() or public.is_staff()));

-- ---------- prova ----------
create policy cfg_read  on public.exam_config for select to authenticated using (true);
create policy cfg_write on public.exam_config for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A tabela com o gabarito é fechada a quem não corrige. O candidato lê as
-- questões pela view exam_questions_public, que não traz `correct`.
create policy q_staff on public.exam_questions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- A tentativa nasce e se transforma pelos RPCs (security definer); aqui é só
-- leitura: cada um vê a própria, o comando vê todas.
create policy at_read on public.exam_attempts for select to authenticated
  using (profile_id = auth.uid() or public.is_staff());

create policy an_read on public.exam_answers for select to authenticated
  using (exists (select 1 from public.exam_attempts t
                  where t.id = attempt_id
                    and (t.profile_id = auth.uid() or public.is_staff())));

-- ---------- cargos ----------
-- O cargo é etiqueta visível: aparece ao lado do nome, como a cor. Quem cria,
-- renomeia e distribui é o ADMIN.
create policy cargo_read  on public.cargos for select to authenticated using (true);
create policy cargo_write on public.cargos for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy cargom_read  on public.cargo_membros for select to authenticated using (true);
create policy cargom_write on public.cargo_membros for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Quais cargos abrem qual canal: quem já enxerga o canal pode ler, para a
-- lista de acesso não mentir sobre quem entra ali. Mexer, só quem configura
-- canal. As funções de visibilidade leem estas tabelas por dentro, como
-- `security definer`, então a regra daqui não tranca ninguém para fora.
create policy catcargo_read on public.category_cargos for select to authenticated
  using (public.can_see_category(category_id) or public.is_staff());
create policy catcargo_write on public.category_cargos for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy chcargo_read on public.channel_cargos for select to authenticated
  using (public.can_read_channel('chan:' || channel_id::text) or public.is_staff());
create policy chcargo_write on public.channel_cargos for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- O histórico de vereditos é do ADMIN. Ele guarda nome e nota de gente que já
-- não tem conta; não é coisa para circular na unidade.
create policy log_read on public.exam_log for select to authenticated
  using (public.is_admin());

-- ============================================================================
-- 9. REALTIME
-- ============================================================================
do $do$
declare t text;
begin
  foreach t in array array['profiles','messages','categories','channels',
                           'category_members','channel_members','sidebar_order',
                           'exam_attempts','exam_questions',
                           'cargos','cargo_membros','category_cargos','channel_cargos']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
             when undefined_object  then null;
    end;
  end loop;
end $do$;

-- DELETE em tempo real precisa da linha antiga completa
alter table public.profiles       replica identity full;
alter table public.channels       replica identity full;
alter table public.categories     replica identity full;
alter table public.messages       replica identity full;
alter table public.sidebar_order  replica identity full;
alter table public.exam_attempts  replica identity full;
alter table public.exam_questions replica identity full;
alter table public.cargos          replica identity full;
alter table public.cargo_membros   replica identity full;

-- ============================================================================
-- 10. RECARGA DO CACHE
-- ============================================================================
-- O PostgREST guarda um retrato do schema; sem este aviso, uma tabela ou
-- função recém-criada pode demorar a aparecer para o site, com o erro
-- "Could not find the table ... in the schema cache".
notify pgrst, 'reload schema';

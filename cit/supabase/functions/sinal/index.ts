// Edge Function `sinal`: tudo o que o bot (Fukurou) faz no Discord.
//
//   avisar   o gatilho avisa_discord manda a lista de IDs e o texto do aviso
//   escutar  o pg_cron, a cada 10 s, pede para buscar o que chegou no privado
//   enviar   um MASTER, pela página do Fukurou, responde numa conversa
//
// Cada mensagem enviada ou recebida vai para o espelho (fukurou_chats e
// fukurou_msgs), que só MASTER lê. Os dois primeiros pedidos vêm do banco e se
// identificam pelo SINAL_SECRET; o terceiro vem do site, com a sessão de quem
// escreveu, e só passa se a conta for MASTER.
//
// Segredos (Edge Functions → Secrets, no painel do Supabase):
//   DISCORD_TOKEN  token do bot (Discord Developer Portal → Bot → Reset Token)
//   SINAL_SECRET   o mesmo valor gravado em discord_config.secret
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY o Supabase já fornece sozinho.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const TOKEN = Deno.env.get('DISCORD_TOKEN');
const SEGREDO = Deno.env.get('SINAL_SECRET');
const API = 'https://discord.com/api/v10';
const AVISO = 'Sinal interceptado.... realidade não catalogada... verifique o sistema interno do CIT, uma nova mensagem lhe aguarda';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

// O site chama esta função do navegador, então ela responde ao CORS.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resposta = (dados: unknown, status = 200) =>
  Response.json(dados, { status, headers: CORS });

/** Chamada à API do Discord, respeitando o limite de taxa (status 429). */
async function discord(metodo: string, path: string, body?: unknown) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const r = await fetch(API + path, {
      method: metodo,
      headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 429) {
      const { retry_after } = await r.json();
      await new Promise(ok => setTimeout(ok, (retry_after ?? 1) * 1000));
      continue;
    }
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    return r.json();
  }
  throw new Error(`${path}: limite de taxa do Discord`);
}

/** O que mostrar de uma mensagem do Discord: o texto e os anexos, por link. */
function corpo(m: any) {
  const partes = [m.content, ...(m.attachments ?? []).map((a: any) => a.url)].filter(Boolean);
  if (partes.length) return partes.join('\n');
  return m.sticker_items?.length ? '[figurinha]' : '[mensagem sem texto]';
}

/** Grava mensagens no espelho; as que já estão lá ficam como estão. */
async function guarda(discordId: string, msgs: any[], autor: string | null = null) {
  if (!msgs.length) return;
  const { error } = await db.from('fukurou_msgs').upsert(
    msgs.map(m => ({
      id: m.id,
      discord_id: discordId,
      from_bot: !!m.author?.bot,
      body: corpo(m),
      sent_by: autor,
      created_at: m.timestamp,
    })),
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) throw new Error('espelho: ' + error.message);
  await db.from('fukurou_chats')
    .update({ updated_at: msgs[msgs.length - 1].timestamp })
    .eq('discord_id', discordId);
}

/**
 * Abre o privado (o Discord devolve o mesmo canal se já existir) e garante a
 * conversa no espelho, com o nome atualizado. `last_msg_id` não é tocado: só
 * a escuta avança, senão uma resposta ainda não buscada ficaria para trás.
 */
async function conversa(discordId: string) {
  const dm = await discord('POST', '/users/@me/channels', { recipient_id: discordId });
  const u = dm.recipients?.[0] ?? {};
  const { error } = await db.from('fukurou_chats').upsert(
    { discord_id: discordId, dm_channel_id: dm.id, username: u.username ?? null, display_name: u.global_name ?? null },
    { onConflict: 'discord_id' },
  );
  if (error) throw new Error('espelho: ' + error.message);
  return dm.id as string;
}

async function envia(discordId: string, texto: string, autor: string | null = null) {
  const canal = await conversa(discordId);
  const m = await discord('POST', `/channels/${canal}/messages`, { content: texto });
  await guarda(discordId, [m], autor);
  return m;
}

/** Busca, em cada conversa, o que chegou desde a última busca. */
async function escuta() {
  // Quem recebeu aviso antes de existir o espelho entra nele agora.
  const { data: avisados } = await db.from('discord_links').select('discord_id').not('last_ping', 'is', null);
  const { data: conhecidos } = await db.from('fukurou_chats').select('discord_id');
  const ja = new Set((conhecidos ?? []).map(c => c.discord_id));
  for (const { discord_id } of avisados ?? []) {
    if (!ja.has(discord_id)) await conversa(discord_id).catch(e => console.error(String(e)));
  }

  const { data: chats } = await db.from('fukurou_chats').select('discord_id, dm_channel_id, last_msg_id');
  for (const c of chats ?? []) {
    try {
      const filtro = c.last_msg_id ? `after=${c.last_msg_id}&limit=100` : 'limit=50';
      const msgs: any[] = await discord('GET', `/channels/${c.dm_channel_id}/messages?${filtro}`);
      if (!msgs.length) continue;
      msgs.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      await guarda(c.discord_id, msgs);
      await db.from('fukurou_chats').update({ last_msg_id: msgs[msgs.length - 1].id }).eq('discord_id', c.discord_id);
    } catch (e) {
      console.error(String(e));
    }
  }
}

/** A conta da sessão que chamou, se for MASTER; senão, null. */
async function masterDaSessao(req: Request) {
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!jwt) return null;
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user) return null;
  const { data: p } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return p?.role === 'master' ? user.id : null;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const pedido = await req.json().catch(() => ({}));
  const doBanco = !!SEGREDO && req.headers.get('x-sinal-secret') === SEGREDO;

  if (doBanco && pedido.acao === 'escutar') {
    await escuta();
    return resposta({ ok: true });
  }

  if (doBanco && (pedido.acao === 'avisar' || !pedido.acao)) {
    // Um de cada vez: são poucos por mensagem e o Discord pune rajadas.
    // O privado só abre se o bot e a pessoa estiverem num mesmo servidor
    // (erro 50007 caso contrário, ou se ela fechou o privado para membros).
    const ids: string[] = pedido.ids ?? [];
    const texto = (pedido.texto || '').trim() || AVISO;
    const falhas: string[] = [];
    for (const id of ids) {
      try {
        await envia(id, texto);
      } catch (e) {
        falhas.push(String(e));
      }
    }
    if (falhas.length) console.error(falhas.join('\n'));
    return resposta({ enviados: ids.length - falhas.length, falhas: falhas.length });
  }

  if (pedido.acao === 'enviar') {
    const autor = await masterDaSessao(req);
    if (!autor) return resposta({ erro: 'Só a credencial MASTER fala pelo Fukurou.' }, 403);
    const texto = String(pedido.texto ?? '').trim();
    if (!texto || texto.length > 2000) return resposta({ erro: 'Mensagem: de 1 a 2000 caracteres.' }, 400);
    try {
      const m = await envia(String(pedido.discord_id), texto, autor);
      return resposta({ ok: true, id: m.id });
    } catch (e) {
      console.error(String(e));
      const fechado = String(e).includes('50007');
      return resposta({
        erro: fechado
          ? 'O Discord recusou: a pessoa fechou o privado ou saiu do servidor do bot.'
          : 'O Discord recusou a mensagem. Detalhes nos logs da função.',
      }, 502);
    }
  }

  return resposta({ erro: 'negado' }, 401);
});

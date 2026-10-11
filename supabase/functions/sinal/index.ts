// Edge Function `sinal`: recebe do banco (gatilho avisa_discord, no schema.sql)
// a lista de IDs do Discord a avisar e manda a cada um, no privado, o aviso de
// sinal interceptado. Quem escolhe os destinatários e controla o intervalo é o
// banco; aqui só se entrega.
//
// Segredos (Edge Functions → Secrets, no painel do Supabase):
//   DISCORD_TOKEN  token do bot (Discord Developer Portal → Bot → Reset Token)
//   SINAL_SECRET   o mesmo valor gravado em discord_config.secret

const TOKEN = Deno.env.get('DISCORD_TOKEN');
const SEGREDO = Deno.env.get('SINAL_SECRET');
const API = 'https://discord.com/api/v10';
const AVISO = 'Sinal interceptado.... realidade não catalogada... verifique o sistema interno do CIT, uma nova mensagem lhe aguarda';

/** POST na API do Discord, respeitando o limite de taxa (status 429). */
async function discord(path: string, body: unknown) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const r = await fetch(API + path, {
      method: 'POST',
      headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

Deno.serve(async req => {
  if (!SEGREDO || req.headers.get('x-sinal-secret') !== SEGREDO) {
    return new Response('negado', { status: 401 });
  }
  const { ids } = await req.json();
  const falhas: string[] = [];

  // Um de cada vez: são poucos por mensagem e o Discord pune rajadas.
  // O privado só abre se o bot e a pessoa estiverem num mesmo servidor
  // (erro 50007 caso contrário, ou se ela fechou o privado para membros).
  for (const id of ids ?? []) {
    try {
      const dm = await discord('/users/@me/channels', { recipient_id: id });
      await discord(`/channels/${dm.id}/messages`, { content: AVISO });
    } catch (e) {
      falhas.push(String(e));
    }
  }

  if (falhas.length) console.error(falhas.join('\n'));
  return Response.json({ enviados: (ids ?? []).length - falhas.length, falhas: falhas.length });
});

-- ============================================================================
-- VGD · Vanguarda — conteúdo do Curso de Modulação Policial (DPP)
--
-- Rode DEPOIS do schema.sql, no SQL Editor do Supabase. É idempotente: pode
-- ser rodado de novo a cada atualização, sem duplicar canais nem questões.
--
-- O que ele cria:
--   · a categoria ACADEMIA, aberta a candidatos, com as páginas 1 a 4 do
--     curso — é o que a pessoa estuda antes da prova;
--   · a categoria INSTRUÇÃO, restrita ao comando, com a prova prática, o
--     gabarito e os critérios de correção — nada disso pode ser visto por
--     quem vai prestar a prova;
--   · as questões da prova teórica, com gabarito e rubrica de correção
--     automática.
--
-- As mensagens só são publicadas em canal vazio: rodar de novo não apaga nem
-- duplica o que já está lá. Para republicar um canal, apague as mensagens dele
-- antes.
-- ============================================================================

-- ---------------------------------------------------------------- ajudantes
create or replace function public.seed_canal(
  p_nome text, p_topico text, p_cat uuid, p_pos int,
  p_candidatos boolean, p_so_leitura boolean)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare cid uuid;
begin
  select id into cid from public.channels where name = p_nome;
  if cid is null then
    insert into public.channels (name, topic, category_id, inherit_access,
                                 everyone, candidatos, somente_leitura, position)
         values (p_nome, p_topico, p_cat, true, false, p_candidatos, p_so_leitura, p_pos)
      returning id into cid;
  else
    update public.channels
       set topic = p_topico, category_id = p_cat, inherit_access = true,
           candidatos = p_candidatos, somente_leitura = p_so_leitura, position = p_pos
     where id = cid;
  end if;
  return cid;
end $fn$;

create or replace function public.seed_vazio(p_canal uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select not exists (select 1 from public.messages where channel = 'chan:' || p_canal::text);
$fn$;

create or replace function public.seed_msg(p_canal uuid, p_autor uuid, p_corpo text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_autor is null then return; end if;
  insert into public.messages (channel, author_id, body)
       values ('chan:' || p_canal::text, p_autor, p_corpo);
end $fn$;

/**
 * Semeia uma questão da prova. `p_chave` é a identidade estável: rodar de novo
 * atualiza a questão em vez de criar outra, e as respostas já dadas continuam
 * apontando para a mesma linha.
 */
create or replace function public.seed_questao(
  p_chave text, p_pos int, p_kind text, p_prompt text, p_pontos int,
  p_opcoes jsonb default '[]'::jsonb, p_correta text default null,
  p_rubrica jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.exam_questions (chave, position, kind, prompt, points, options, correct, rubrica, active)
       values (p_chave, p_pos, p_kind, p_prompt, p_pontos, p_opcoes, p_correta, p_rubrica, true)
  on conflict (chave) do update
     set position = excluded.position, kind = excluded.kind, prompt = excluded.prompt,
         points = excluded.points, options = excluded.options, correct = excluded.correct,
         rubrica = excluded.rubrica, active = true;
end $fn$;

-- ============================================================================
-- CANAIS E MATERIAL
-- ============================================================================
do $seed$
declare
  autor uuid;
  academia uuid; instrucao uuid;
  ch uuid;
begin
  -- As mensagens precisam de um autor. Sem nenhum ADMIN cadastrado ainda, os
  -- canais nascem do mesmo jeito e o conteúdo entra numa próxima rodada.
  select id into autor from public.profiles where role = 'admin' order by created_at limit 1;

  -- ---------- ACADEMIA: aberta a quem ainda vai prestar a prova ----------
  select id into academia from public.categories where name = 'ACADEMIA';
  if academia is null then
    insert into public.categories (name, everyone, candidatos, position)
         values ('ACADEMIA', true, true, 0) returning id into academia;
  else
    update public.categories set everyone = true, candidatos = true, position = 0
     where id = academia;
  end if;

  -- ---------- INSTRUÇÃO: gabarito e prova prática, longe do candidato ----------
  select id into instrucao from public.categories where name = 'INSTRUÇÃO';
  if instrucao is null then
    insert into public.categories (name, everyone, candidatos, position)
         values ('INSTRUÇÃO', false, false, 10) returning id into instrucao;
  else
    update public.categories set everyone = false, candidatos = false, position = 10
     where id = instrucao;
  end if;

  -- Quem instrui entra na categoria restrita. Rodar este arquivo de novo
  -- atualiza a lista, o que é como novos oficiais de comando ganham acesso.
  delete from public.category_members where category_id = instrucao;
  insert into public.category_members (category_id, profile_id)
       select instrucao, id from public.profiles where role in ('comando','admin');

  -- ======================================================= apresentação
  ch := public.seed_canal('apresentacao', 'O que é o curso e como se é aprovado',
                          academia, 0, true, true);
  if public.seed_vazio(ch) then
    perform public.seed_msg(ch, autor,
'# Curso de modulação policial
**Departamento de Polícia de Paralela — formação para todo o efetivo**

Este curso prepara policiais de todas as divisões do Departamento para comunicar ocorrências, identificar suas guarnições e usar corretamente a rádio e o painel. Aplica-se ao efetivo do DRE, DPU, CSA, VGD e CIT, respeitadas as funções de cada divisão.');
    perform public.seed_msg(ch, autor,
'# Organização do curso
- **Instrução teórica** — 10 minutos. Explicar o material da ACADEMIA e demonstrar as chamadas.
- **Prova teórica** — 15 a 20 minutos, sem consulta. É a que você faz aqui no site.
- **Prova prática** — 15 a 20 minutos por aluno, em cinco estações, com um instrutor.
- **Devolutiva** — 5 minutos por aluno. Apontar o erro e pedir uma nova execução correta.');
    perform public.seed_msg(ch, autor,
'# Critérios de aprovação
- **Teoria:** 100 pontos, com mínimo sugerido de **70**.
- **Prática:** 100 pontos, com mínimo sugerido de **80**.

As duas etapas devem atingir seus mínimos; uma nota não compensa a outra. A chefia pode ajustar esses critérios antes da aplicação.

> Tempos, notas e rubricas são propostas de avaliação. O objetivo não é reprovar nem fazer ninguém "perder" o curso.');
  end if;

  -- ======================================================= regras básicas
  ch := public.seed_canal('regras-basicas', 'As cinco regras de uma boa modulação',
                          academia, 1, true, true);
  if public.seed_vazio(ch) then
    perform public.seed_msg(ch, autor,
'# Regras básicas de uma boa modulação

1. **Escute antes de transmitir** e organize a informação. Evite falar por cima de outra unidade, conversas paralelas e repetições sem necessidade.

2. **Fale com calma, volume regular e frases curtas.** Identifique a unidade, informe o fato e, quando necessário, a localização, o sentido e o apoio solicitado.

3. **Use os códigos conforme o regulamento.** Se não entender a mensagem, peça repetição; não confirme uma informação que não compreendeu.

4. **Informe apenas o que foi observado ou confirmado.** Diga quando perder o visual; não apresente uma suposição como localização atual.

5. **Painel para os informes previstos, rádio para a coordenação da ocorrência.** O registro no painel não substitui um aviso urgente.');
  end if;

  -- ======================================================= padrão de chamada
  ch := public.seed_canal('padrao-de-chamada', 'QAP Central + unidade e ID do P2 + informe',
                          academia, 2, true, true);
  if public.seed_vazio(ch) then
    perform public.seed_msg(ch, autor,
'# Padrão de chamada
Toda comunicação destinada à Central segue o padrão:

```
QAP Central [Unidade / ID do P2] [informe].
```

Identifique **a unidade que realmente está atuando**.

- `QAP Central, DPU 466 a QTI da QRU de assalto no Posto Norte.`
- `QAP Central, CIT 812 a QTI do apoio solicitado.`

Em motocicleta, acrescente **2** após a identificação da divisão: `Vanguarda2 466`. Em Speed, use `Vanguarda 466`.');
    perform public.seed_msg(ch, autor,
'# Código Q
- **QAP** — Na escuta.
- **QRA** — Identificação por nome e patente.
- **QTH** — Localização.
- **QTI** — A caminho.
- **QRV** — À disposição.
- **QRU** — Ocorrência.
- **QSL** — Entendido.
- **QSM** — Repita ou transmita novamente.
- **QSV / VTR** — Viatura.
- **QTC** — Mensagem ou informe.
- **QRN** — Interferência.
- **QRL** — Ocupado.
- **QRX** — Aguardar ou pausa.
- **QTX** — Saindo de serviço.
- **QRR** — Reforço.
- **QTA** — Abandonar ou cancelar.
- **PTR** — Patrulhamento.');
  end if;

  -- ======================================================= painel e rádio
  ch := public.seed_canal('painel-e-radio', 'O que vai no painel, o que vai na rádio',
                          academia, 3, true, true);
  if public.seed_vazio(ch) then
    perform public.seed_msg(ch, autor,
'# Informes que podem ir direto ao painel
Registre as situações abaixo no painel, sem anunciá-las na rádio. Confira a identificação e o conteúdo antes de enviar.

- **Início de serviço** — `QAP CENTRAL, Soldado Lucas iniciando em QRV.`
- **Saída de serviço** — `QAP CENTRAL, Soldado Lucas indo de QTX. Bom serviço a todos.`
- **Início de patrulha** — `QAP CENTRAL, DPU 466 iniciando COD 0.`
- **Ocupado** — `QAP CENTRAL, DPU 466 em QRL na Mecânica.`
- **Acompanhamento** — marca + cor — emplacamento do veículo | natureza.

Exemplo de veículo: `Karin Sultan preto — BPX4R72 — fuga de abordagem.` O modelo é informação adicional; mantenha **marca, cor, placa e natureza**.');
    perform public.seed_msg(ch, autor,
'# Funções de comunicação na guarnição
O **P2** realiza a comunicação e a modulação via rádio. Na viatura primária, a modulação é obrigação do copiloto. Se o P2 tiver dificuldade de comunicação, outro oficial da mesma viatura pode assumir a função.

A **primária** mantém a comunicação principal do acompanhamento. A **secundária** fica pronta para assumir a condução caso a primária dê QTA. As demais unidades transmitem informações relevantes ao apoio, evitando repetir sem necessidade o que já foi informado.');
    perform public.seed_msg(ch, autor,
'# Informes de abordagem e apoio
O P2 deve comunicar à Central o início da abordagem e atualizar o QTH. Nas situações previstas no regulamento, informa o código de risco aplicável e solicita QRR.

Use a classificação correta, **sem criar uma gravidade que não foi confirmada**.

> `QAP Central, DPU 466 iniciando abordagem Código 2. QTH Rua do Porto. Solicito QRR.`');
  end if;

  -- ======================================================= alfabeto e códigos
  ch := public.seed_canal('alfabeto-e-codigos', 'Alfabeto fonético, códigos 0 a 6 e perda de visual',
                          academia, 4, true, true);
  if public.seed_vazio(ch) then
    perform public.seed_msg(ch, autor,
'# Alfabeto fonético
`A` Alfa · `B` Bravo · `C` Charlie · `D` Delta · `E` Echo · `F` Fox · `G` Golf · `H` Hotel · `I` India
`J` Juliet · `K` Kilo · `L` Lima · `M` Mike · `N` November · `O` Oscar · `P` Papa · `Q` Quebec · `R` Roma
`S` Sierra · `T` Tango · `U` Uniform · `V` Victor · `W` Whiskey · `X` X-ray · `Y` Yankee · `Z` Zulu

Exemplo: **BPX4R72** = Bravo, Papa, X-ray, quatro, Roma, sete, dois.

Não substitua uma letra duvidosa por uma suposição.');
    perform public.seed_msg(ch, autor,
'# Códigos de segurança
- **Código 0** — Em patrulha.
- **Código 1** — Baixo risco.
- **Código 2** — Médio risco.
- **Código 3** — Alto risco.
- **Código 4** — Área segura.
- **Código 5** — Fogo liberado.
- **Código 6** — Policiais investigando o local em 360°.');
    perform public.seed_msg(ch, autor,
'# Perda de visual e interrupção do acompanhamento
**Código 6** destina-se à localização do veículo após perda do visual. Informe a perda e o último QTH confirmado.

Capotamento da viatura ou queda da moto R1200 obriga a retirada da perseguição, informando **QTA** na rádio, se possível. Se houver feridos, comunique a necessidade de atendimento. A secundária fica pronta para assumir.');
  end if;

  -- ======================================================= prova prática
  ch := public.seed_canal('prova-pratica', 'As cinco estações — material do instrutor',
                          instrucao, 0, false, true);
  if public.seed_vazio(ch) then
    perform public.seed_msg(ch, autor,
'# Avaliação prática de modulação
Aplique **após** recolher a prova teórica. Utilize rádio de treinamento e painel de treino. O instrutor interpreta a Central e as demais unidades. Todos os alunos executam os mesmos papéis simulados, independentemente da divisão de origem.

Leia um evento por vez e observe a resposta antes de continuar. Cada estação vale **20 pontos**, em quatro critérios de 5. Tempo sugerido: 15 a 20 minutos por aluno.

**Não apresente o gabarito durante a avaliação.**

## Escala de cada critério
- **5 pontos** — execução correta e autônoma.
- **2,5 pontos** — execução parcial, ou correção após um lembrete neutro.
- **0 ponto** — não executa, informa dado errado que altera o sentido, ou só responde após receber a solução.

Autocorreção imediata, antes de intervenção do instrutor, pode receber 5 pontos.');
    perform public.seed_msg(ch, autor,
'## Estação 1 — Serviço e situação no painel
**Leia ao aluno:** Você é o Soldado Lucas, P2 da DPU, ID 466. Inicie o serviço em QRV e a patrulha em COD 0. Depois, informe que a unidade está ocupada na Mecânica.

**Aplicação:** disponibilize campos de registro e observe se o aluno escolhe o painel para os três informes.

**Critérios de 5 pontos:** escolhe o painel; registra o início com nome e QRV; registra DPU 466 e COD 0; informa DPU 466 em QRL na Mecânica.');
    perform public.seed_msg(ch, autor,
'## Estação 2 — Acionamento e mensagem incompreensível
**Leia ao aluno:** Você é o P2 da DRE 812, acionada para apoio no Posto Norte. Informe seu deslocamento à Central.

**Aplicação:** simule uma mensagem cortada — "O acesso será pela Rua do [inaudível]". Ao receber pedido de repetição, diga: "O acesso será pela Rua do Porto".

**Critérios de 5 pontos:** usa QAP Central e DRE 812; informa QTI, apoio e destino; pede QSM sem adivinhar o trecho; confirma com QSL após compreender.');
    perform public.seed_msg(ch, autor,
'## Estação 3 — Abordagem e início de acompanhamento
**Leia ao aluno:** Como P2 da DPU 466, inicie uma abordagem Código 2 na Avenida Central e solicite QRR. Depois, um Karin Sultan preto, BPX4R72, foge da abordagem, sentido Posto Norte.

**Aplicação:** peça a comunicação inicial, o registro da fuga no painel e a atualização pela rádio. Ao final, solicite que esclareça as letras BPX.

**Critérios de 5 pontos:** comunica Código 2, QTH e QRR; registra marca, cor, placa e natureza no painel; atualiza o acompanhamento com identificação, QTH e sentido; soletra Bravo, Papa, X-ray.');
    perform public.seed_msg(ch, autor,
'## Estação 4 — Perda de visual e controle da contagem
**Leia ao aluno:** Como P2 da DPU 466, você perdeu o visual. A contagem para Código 5 somava 6 minutos. Último QTH: Rua do Porto, sentido Posto Norte. Comunique a situação.

**Aplicação:** apresente três alternativas independentes — visual retomado após 1 minuto e 30 segundos; após 4 minutos; 16 minutos sem visual. Peça a comunicação da decisão em cada uma.

**Critérios de 5 pontos:** informa perda de visual, último QTH e Código 6; no primeiro caso retoma de 6 minutos; no segundo reinicia a contagem; no terceiro comunica QTA obrigatório.');
    perform public.seed_msg(ch, autor,
'## Estação 5 — Interrupção e passagem da comunicação
**Leia ao aluno:** A DPU 466, primária, capotou na Rua do Porto. Há um policial ferido e o rádio funciona. A DRE 812, secundária, está apta a assumir. Comunique sua conduta.

**Aplicação:** interprete a DRE 812 e confirme que assumiu. Depois avance — "O atendimento foi resolvido e agora você encerrará o serviço". Solicite o registro de encerramento.

**Critérios de 5 pontos:** informa QTA por capotamento; solicita atendimento com QTH; comunica a passagem para DRE 812 e deixa a função de primária; registra QTX no painel quando o serviço é encerrado.');
  end if;

  -- ======================================================= gabarito
  ch := public.seed_canal('gabarito', 'Respostas e critérios — nunca mostrar a candidato',
                          instrucao, 1, false, true);
  if public.seed_vazio(ch) then
    perform public.seed_msg(ch, autor,
'# Gabarito da prova teórica
> Este canal é restrito ao comando. Nada daqui pode chegar a quem ainda vai prestar a prova.

## Objetivas
- **Qual é o objetivo de uma boa modulação?** — `C`. Clareza e objetividade na comunicação.
- **Qual ID integra o padrão de chamada?** — `B`. Unidade e ID do P2 compõem a chamada.
- **Qual sequência corresponde ao padrão?** — `A`. QAP Central + unidade e ID do P2 + informe.
- **Qual informe pode ir direto ao painel?** — `A`. Início de serviço pode ir direto ao painel.
- **Interferência impediu entender o destino** — `D`. Pedir repetição e confirmar após compreender.
- **Código 4 significa** — `A`. Código 4 indica área segura.');
    perform public.seed_msg(ch, autor,
'## Chamadas de diferentes guarnições
a) `QAP Central, DPU 466 a QTI da QRU de assalto no Posto Norte.`
b) `QAP Central, DRE 812 a QTI do apoio solicitado na Rua do Porto.`

**Correção de cada chamada, até 6 pontos:** abertura QAP Central, 1; unidade correta, 1; ID do P2 correto, 1; QTI, 1; ocorrência ou apoio, 1; destino, 1.

Aceite variações que mantenham esses elementos.');
    perform public.seed_msg(ch, autor,
'## Rádio ou painel
a) **P.** Início de serviço em QRV está entre os registros previstos no painel.
b) **R.** O início da abordagem, o QTH e o pedido de QRR exigem comunicação à Central para coordenação da ocorrência.
c) **P.** QRL na Mecânica é um dos exemplos de registro direto do artigo 8.1.
d) **P.** Trata-se do cadastro do veículo; a comunicação dinâmica da ocorrência continua na rádio.

**Correção:** 2 pontos pela escolha correta e 1 pela justificativa coerente, em cada item. Não exija repetição literal do gabarito.');
    perform public.seed_msg(ch, autor,
'## Referências de fala para a prova prática
**Estação 1:** "QAP CENTRAL, Soldado Lucas iniciando em QRV." Depois: "QAP CENTRAL, DPU 466 iniciando COD 0." Ao ficar ocupado: "QAP CENTRAL, DPU 466 em QRL na Mecânica."

**Estação 2:** "QAP Central, DRE 812 a QTI do apoio no Posto Norte." Se não entender: "QAP Central, DRE 812, QSM do acesso ao local." Após a repetição: "QAP Central, DRE 812, QSL, acesso pela Rua do Porto."

**Estação 3:** "QAP Central, DPU 466 iniciando abordagem Código 2, QTH Avenida Central. Solicito QRR." Após a fuga: "QAP Central, DPU 466 em acompanhamento de fuga de abordagem, QTH Avenida Central, sentido Posto Norte."

**Estação 4:** "QAP Central, DPU 466, perdido o visual. Último QTH Rua do Porto, sentido Posto Norte. Iniciando Código 6."

**Estação 5:** ao encerrar o serviço, "QAP CENTRAL, Soldado Lucas indo de QTX."');
  end if;

  -- ======================================================= aplicação
  ch := public.seed_canal('aplicacao', 'Como conduzir e corrigir a avaliação',
                          instrucao, 2, false, true);
  if public.seed_vazio(ch) then
    perform public.seed_msg(ch, autor,
'# O que observar durante toda a prática
A Central deve entender **quem fala, o que aconteceu, onde ocorreu e qual providência** é informada ou solicitada. Aceite variações de frase que preservem o padrão e o conteúdo. Mantenha os dados simulados iguais para todos os candidatos.

Se o aluno sobrepuser a fala de outra unidade, confundir QTH com QTI, inventar uma placa ou confirmar mensagem incompreensível, registre o fato no critério correspondente. **Não desconte duas vezes pelo mesmo erro dentro do mesmo critério.**');
    perform public.seed_msg(ch, autor,
'# Correção e nova tentativa
Conclua e pontue a primeira execução **antes** de ensinar a resposta. Na devolutiva, demonstre a forma adequada e peça a repetição do trecho. Registre uma segunda execução separadamente, sem apagar a nota inicial.

**Recuperação:** revisar os tópicos com erro e repetir as estações com outro ID, local e placa. O instrutor define previamente se a nova avaliação substituirá a nota ou servirá apenas como treino.

# Preparação da aplicação
Defina canal e painel de treino, confira os locais adotados e comunique os critérios de aprovação. Os cenários avaliam comunicação e registro; os eventos são apresentados pelo instrutor, sem necessidade de provocar acidentes ou executar manobras.');
  end if;
end $seed$;

-- ============================================================================
-- PROVA TEÓRICA
-- ============================================================================
-- Pontuação do PDF: objetivas 4 pontos, questões abertas 12 pontos por bloco.
-- Como o material entregue traz 6 das 10 objetivas e 2 dos 5 blocos abertos, a
-- prova soma 48 pontos. O corte continua sendo percentual (70%), como manda o
-- curso, então a conta fecha mesmo com a prova mais curta. Acrescentando as
-- questões que faltam pelo Banco de Questões, o total sobe sozinho.

do $prova$
begin
  -- ---------------- objetivas, 4 pontos cada ----------------
  perform public.seed_questao('mod-obj-01', 0, 'objetiva',
    'Qual é o objetivo de uma boa modulação?', 4,
    jsonb_build_array(
      jsonb_build_object('id','a','text','Transmitir todos os detalhes, mesmo os que não ajudam na ocorrência.'),
      jsonb_build_object('id','b','text','Manter a frequência ocupada para demonstrar presença.'),
      jsonb_build_object('id','c','text','Comunicar o necessário com clareza e objetividade.'),
      jsonb_build_object('id','d','text','Trocar informações apenas quando a Central repetir a solicitação.')),
    'c');

  perform public.seed_questao('mod-obj-02', 1, 'objetiva',
    'Qual ID integra o padrão de chamada à Central previsto no regulamento?', 4,
    jsonb_build_array(
      jsonb_build_object('id','a','text','O ID de qualquer policial que esteja na frequência.'),
      jsonb_build_object('id','b','text','O ID do P2, junto à identificação da unidade.'),
      jsonb_build_object('id','c','text','Somente o número da placa da viatura.'),
      jsonb_build_object('id','d','text','Nenhum ID, pois basta informar a patente.')),
    'b');

  perform public.seed_questao('mod-obj-03', 2, 'objetiva',
    'Qual sequência corresponde ao padrão de chamada à Central?', 4,
    jsonb_build_array(
      jsonb_build_object('id','a','text','QAP Central, unidade e ID do P2, informe.'),
      jsonb_build_object('id','b','text','Informe, despedida e nome do suspeito.'),
      jsonb_build_object('id','c','text','Apenas o código Q, sem identificação da unidade.'),
      jsonb_build_object('id','d','text','Local, conversa livre e identificação somente se for solicitada.')),
    'a');

  perform public.seed_questao('mod-obj-04', 3, 'objetiva',
    'Qual informe pode ser registrado diretamente no painel?', 4,
    jsonb_build_array(
      jsonb_build_object('id','a','text','Início de serviço em QRV.'),
      jsonb_build_object('id','b','text','Capotamento da primária durante uma ocorrência ativa.'),
      jsonb_build_object('id','c','text','Pedido urgente de reforço durante uma abordagem.'),
      jsonb_build_object('id','d','text','Perda de visual que exige coordenação imediata das unidades.')),
    'a');

  perform public.seed_questao('mod-obj-05', 4, 'objetiva',
    'Uma interferência impediu entender o destino informado. Qual conduta é adequada?', 4,
    jsonb_build_array(
      jsonb_build_object('id','a','text','Responder QSL e seguir para o local que parece mais provável.'),
      jsonb_build_object('id','b','text','Encerrar o serviço sem avisar.'),
      jsonb_build_object('id','c','text','Repetir a parte incompreensível como se fosse confirmada.'),
      jsonb_build_object('id','d','text','Solicitar QSM e confirmar com QSL após compreender a repetição.')),
    'd');

  perform public.seed_questao('mod-obj-06', 5, 'objetiva',
    'No capítulo de códigos de segurança, Código 4 significa:', 4,
    jsonb_build_array(
      jsonb_build_object('id','a','text','Área segura.'),
      jsonb_build_object('id','b','text','Alto risco.'),
      jsonb_build_object('id','c','text','Saída de serviço.'),
      jsonb_build_object('id','d','text','Pedido de reforço.')),
    'a');

  -- ---------------- chamadas à Central, 6 pontos cada ----------------
  -- A rubrica é a tradução literal do critério do PDF: "abertura QAP Central,
  -- 1; unidade correta, 1; ID do P2 correto, 1; QTI, 1; ocorrência ou apoio,
  -- 1; destino, 1". `\y` é a borda de palavra do Postgres — sem ela, "466"
  -- casaria dentro de "4660".
  perform public.seed_questao('mod-cham-a', 6, 'aberta',
    'Escreva a chamada à Central informando o deslocamento.' || chr(10) || chr(10) ||
    'Unidade DPU, ID do P2 466, a caminho de um assalto no Posto Norte.', 6,
    '[]'::jsonb, null,
    jsonb_build_array(
      jsonb_build_object('rotulo','abertura QAP Central','pontos',1,'re','qap\s*central'),
      jsonb_build_object('rotulo','unidade DPU','pontos',1,'re','\ydpu\y'),
      jsonb_build_object('rotulo','ID do P2 466','pontos',1,'re','\y466\y'),
      jsonb_build_object('rotulo','QTI','pontos',1,'re','\yqti\y'),
      jsonb_build_object('rotulo','ocorrência (assalto/QRU)','pontos',1,'re','assalto|\yqru\y'),
      jsonb_build_object('rotulo','destino Posto Norte','pontos',1,'re','posto\s*norte')));

  perform public.seed_questao('mod-cham-b', 7, 'aberta',
    'Escreva a chamada à Central informando o deslocamento.' || chr(10) || chr(10) ||
    'Unidade DRE, ID do P2 812, a caminho do apoio solicitado na Rua do Porto.', 6,
    '[]'::jsonb, null,
    jsonb_build_array(
      jsonb_build_object('rotulo','abertura QAP Central','pontos',1,'re','qap\s*central'),
      jsonb_build_object('rotulo','unidade DRE','pontos',1,'re','\ydre\y'),
      jsonb_build_object('rotulo','ID do P2 812','pontos',1,'re','\y812\y'),
      jsonb_build_object('rotulo','QTI','pontos',1,'re','\yqti\y'),
      jsonb_build_object('rotulo','apoio','pontos',1,'re','apoio'),
      jsonb_build_object('rotulo','destino Rua do Porto','pontos',1,'re','rua\s*do\s*porto')));

  -- ---------------- rádio ou painel, 3 pontos cada ----------------
  -- 2 pontos pela escolha e 1 pela justificativa, como o PDF manda. A escolha
  -- é lida no começo da resposta — por isso o enunciado pede a letra primeiro.
  perform public.seed_questao('mod-meio-a', 8, 'aberta',
    'Rádio ou painel? Comece a resposta com a letra **R** (rádio) ou **P** (painel) e justifique em uma frase.' || chr(10) || chr(10) ||
    'O policial está iniciando o serviço e ficará em QRV.', 3,
    '[]'::jsonb, null,
    jsonb_build_array(
      jsonb_build_object('rotulo','escolha P (painel)','pontos',2,'re','^\s*\(?\s*(p\y|painel)'),
      jsonb_build_object('rotulo','justificativa coerente','pontos',1,'re','painel|registr|\yqrv\y|in[íi]cio de servi[çc]o')));

  perform public.seed_questao('mod-meio-b', 9, 'aberta',
    'Rádio ou painel? Comece a resposta com a letra **R** (rádio) ou **P** (painel) e justifique em uma frase.' || chr(10) || chr(10) ||
    'A guarnição iniciou uma abordagem Código 2 e precisa atualizar o QTH e solicitar QRR.', 3,
    '[]'::jsonb, null,
    jsonb_build_array(
      jsonb_build_object('rotulo','escolha R (rádio)','pontos',2,'re','^\s*\(?\s*(r\y|r[áa]dio)'),
      jsonb_build_object('rotulo','justificativa coerente','pontos',1,'re','central|coordena|\yqrr\y|\yqth\y|abordagem')));

  perform public.seed_questao('mod-meio-c', 10, 'aberta',
    'Rádio ou painel? Comece a resposta com a letra **R** (rádio) ou **P** (painel) e justifique em uma frase.' || chr(10) || chr(10) ||
    'A DPU 466 está ocupada na Mecânica e precisa informar QRL.', 3,
    '[]'::jsonb, null,
    jsonb_build_array(
      jsonb_build_object('rotulo','escolha P (painel)','pontos',2,'re','^\s*\(?\s*(p\y|painel)'),
      jsonb_build_object('rotulo','justificativa coerente','pontos',1,'re','painel|registr|\yqrl\y|mec[âa]nica')));

  perform public.seed_questao('mod-meio-d', 11, 'aberta',
    'Rádio ou painel? Comece a resposta com a letra **R** (rádio) ou **P** (painel) e justifique em uma frase.' || chr(10) || chr(10) ||
    'É necessário cadastrar marca, cor, placa e natureza de uma fuga de abordagem. A coordenação da ocorrência já está na rádio.', 3,
    '[]'::jsonb, null,
    jsonb_build_array(
      jsonb_build_object('rotulo','escolha P (painel)','pontos',2,'re','^\s*\(?\s*(p\y|painel)'),
      jsonb_build_object('rotulo','justificativa coerente','pontos',1,'re','painel|cadastr|ve[íi]culo|placa|registr')));
end $prova$;

-- Nota de corte e abertura da prova, conforme o curso.
update public.exam_config
   set min_percent = 70,
       intro = 'Prova teórica do Curso de Modulação Policial do Departamento de Polícia de Paralela. '
            || 'Sem consulta. Leia o material da ACADEMIA antes de começar: é dali que saem todas as questões. '
            || 'Você tem uma tentativa; uma nova depende do comando.',
       updated_at = now()
 where id;

notify pgrst, 'reload schema';

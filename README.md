# CIT · Paralela — comunicação anônima para RolePlay

Site estático (sem build). Backend: Supabase. Hospedagem: Vercel.

> Este repositório abriga dois sites irmãos: o **CIT**, aqui na raiz, e a
> **VGD · Vanguarda**, em [`vgd/`](vgd/). Bancos Supabase separados e projetos
> separados na Vercel — o da VGD aponta para o mesmo repositório com
> *Root Directory* `vgd`. Nada é compartilhado entre os dois.

```
index.html   estrutura
style.css    visual
config.js    URL e chave anon do Supabase
format.js    formatação de texto (negrito, tópicos, etc.)
fx.js        ambientação: som, decodificação, relógio, chuva de caracteres
app.js       acesso, barra de canais, mensagens e edição
ops.js       dossiês de operação (painel lateral direito)
entidades.js cadastro de entidades, seletor do dossiê e conversão do texto livre
manage.js    gerenciar usuários (ADMIN) e criar canais/categorias (COMANDO)
teia.js      Teia de Vínculos: o grafo geral e o de cada operação
avisos.js    caixa de avisos (conexões encontradas entre operações)
search.js    varredura global (Ctrl+F)
fukurou.js   página do bot (Fukurou), só para MASTER
schema.sql   banco de dados completo
supabase/functions/sinal   Edge Function que manda o aviso no Discord
```

## Setup

1. Crie um projeto em supabase.com.
2. **Authentication → Providers → Email**: desligue *Confirm email* (os agentes usam e-mails fictícios derivados do codinome).
3. **SQL Editor**: cole o `schema.sql` inteiro e rode. Ele é **idempotente** — rode de novo a cada atualização do site, sem perder dados.
4. **Project Settings → API**: copie *Project URL* e *anon public key* para o `config.js`.
5. Suba para o GitHub e importe no Vercel (Framework: *Other*, sem build command).

> A chave `anon` pode ficar no código: a segurança vem das regras de RLS do `schema.sql`.

## Códigos de acesso

Digitados uma única vez, no cadastro. Definem o cargo da conta.

Há um código por cargo. **Eles não estão neste repositório** — vivem só na
tabela `invite_codes`, no banco. Ver os que estão valendo:

```sql
select role, code from invite_codes order by role;
```

| Cargo   | Pode                                                                 |
|---------|----------------------------------------------------------------------|
| AGENTE  | ler/escrever nos canais liberados, criar e editar dossiês e relatos  |
| COMANDO | tudo do agente + criar categorias e canais, editar mensagens alheias, remover agentes |
| ADMIN   | tudo do comando + criar/excluir contas, dar e tirar privilégios, trocar codinomes, redefinir senhas |

O cargo **não aparece no chat**: nada indica quais codinomes são de comando ou
admin. Só o painel ⚙ mostra isso, e só para o ADMIN.

Trocar um código, no SQL Editor do Supabase:

```sql
update invite_codes set code = 'NOVO' where role = 'command';
```

O `schema.sql` não mexe em código nenhum que já esteja gravado, então pode ser
rodado de novo à vontade depois de uma troca.

> Nunca escreva um código dentro de arquivo versionado. Este repositório é
> público: um código no `schema.sql` ou aqui é um código entregue a quem
> abrir o repositório — e o histórico do git não esquece.

Numa instalação nova, o `schema.sql` cria sozinho um código de ADMIN aleatório,
já que sem ADMIN ninguém cria as demais contas. Leia-o uma vez e troque:

```sql
select code from invite_codes where role = 'admin';
```

Com a primeira conta ADMIN de pé, as demais saem pelo painel ⚙, sem distribuir
código nenhum.
Depois disso o ADMIN cria as demais contas pelo painel, sem distribuir códigos.

## Layout

Quatro colunas, todas **redimensionáveis** pelas alças entre elas e
**colapsáveis** pelo ✕ do cabeçalho ou pelos botões ▤ ▦ ▣ no topo da sala:

1. **Canais** — barra lateral com os canais e as configurações.
2. **Relatos** — a coluna larga, onde as apurações se acumulam. Do mais antigo
   no topo ao mais novo embaixo: rolar para cima é voltar no tempo.
3. **Dossiê** — as informações principais da operação.
4. **Transmissão** — o chat do canal.

No `# geral` só existe a transmissão, sempre aberta e ocupando a sala: ele é
canal de conversa, não tem dossiê.
Nos demais, relatos e dossiê **abrem sozinhos quando há operação** no canal e
ficam recolhidos quando não há — mexer no botão da coluna faz a sua escolha
passar a mandar, e criar uma operação devolve as duas ao automático.

As três de dentro da sala também **trocam de lugar**: arraste o punho ∷ do
cabeçalho de uma sobre a outra e solte à esquerda ou à direita dela. A barra de
canais é a exceção — fica sempre na ponta esquerda.

Por padrão as três dividem a sala em partes iguais; **duplo clique em qualquer
alça** reparte tudo de novo em terços, se você quiser voltar ao equilíbrio.
A coluna de relatos é a elástica: ela absorve a sobra, e as outras é que têm
largura ajustável. Se ela for recolhida, a primeira coluna visível assume esse
papel. Ordem, larguras e colapsos ficam guardados naquele navegador. Abaixo de
900px de largura as colunas empilham na vertical.

## Canais

- `# geral` — todos os agentes.
- `🔒 individuais` — um canal privado por conta, inclusive das contas com
  COMANDO e ADMIN. Cada agente vê só o seu; quem tem COMANDO ou ADMIN vê todos,
  o próprio inclusive.
- **Categorias e canais criados pelo COMANDO** — nome livre, acesso definido na criação:
  *todos os agentes* ou *uma lista escolhida*, e, se quiser, uma **trava de
  código** (logo abaixo). Um canal pode ficar dentro de uma categoria (herdando
  o acesso dela) ou avulso, com acesso próprio.

Quem cria entra automaticamente na lista de acesso. O ADMIN enxerga tudo.

**Recolher grupos**: a seta ▾ ao lado de *Canais individuais* e de cada
categoria esconde os canais dali, com a contagem ao lado para você saber quanto
ficou guardado. Recolhido, o grupo fica em ciano se o canal aberto estiver
dentro dele, e a contagem acende em roxo se chegou mensagem nova lá.

**MEMBROS**, no topo de qualquer canal, lista os codinomes de quem tem acesso a
ele. Mostra só codinomes — o cargo continua invisível, como no chat. Onde o
acesso vem do comando (canais individuais) ou da administração (canais
restritos), a lista diz isso sem nomear ninguém.

### Trava de acesso por código

Ao criar — ou depois, pelo ⚙ — um canal ou uma categoria pode receber um
**código de acesso**. Com ele, estar na lista de acesso não basta: ao abrir o
canal o site pede o código, e **ninguém entra sem ele, nem COMANDO nem ADMIN**.
O código da categoria vale para todos os canais dentro dela; um canal com código
próprio usa o seu, e não o da categoria.

Canal e categoria travados aparecem com ⚿ dourado na barra lateral: a seção
existe à vista de todos, mas só abre para quem tem o código. Acertando, a trava
fica liberada **por aquela sessão** — igual ao login: sobrevive ao F5 e cai
quando o navegador fecha. Enquanto não for liberada, o canal também não aparece
na busca (Ctrl+F), para o trecho não entregar o que a trava esconde.

Errando o código, **a tela treme**, sai o aviso vermelho *ACESSO NEGADO —
SEÇÃO RESTRITA* e toca um alarme.

Só o hash do código é guardado (bcrypt, tabelas `channel_locks` e
`category_locks`), numa tabela que o site nunca lê: a conferência acontece no
banco, por `verify_channel_code` / `verify_category_code`. Esqueceu o código?
Abra o ⚙ e defina outro — não há como recuperar o antigo.

> A trava é a porta da seção, desenhada para a mesa de RP. A parede continua
> sendo a lista de acesso: o que o RLS não deixa o agente ler, ele não lê de
> jeito nenhum.

**Reordenar**: quem tem COMANDO arrasta os itens da barra lateral — dá para pôr
uma categoria acima do `# geral`, mandar os canais individuais para baixo, mover
um canal para dentro de uma categoria (soltando sobre o nome dela) ou reordenar
os canais dentro dela. A ordem é a mesma para todo mundo. Como usa arrastar e
soltar do navegador, funciona no computador, não no toque.

Para **configurar**: o ⚙ ao lado do nome do canal e do nome da categoria, na
barra lateral (também o ✎ no topo do canal aberto). Ali ficam nome, assunto,
categoria, **quem entra** (adicionar e remover agentes), a **trava de código** e
o excluir. Como o ⚙ do canal está na barra, dá para mexer na trava de um canal
sem precisar abri-lo. Excluir um canal apaga junto as mensagens e os
dossiês dele. Excluir uma categoria **não** esconde os canais dentro dela: eles
viram avulsos mantendo o mesmo acesso — e, se a categoria estava travada, a
trava dela some junto (os canais que tiverem trava própria seguem travados).

## Cores e configurações pessoais

Cada conta tem uma cor, usada no codinome do chat e nas listas. Contas novas
recebem a cor menos usada de uma paleta neon de 16, para dois agentes não
nascerem iguais.

O ⚙ ao lado do seu nome, na barra lateral, abre **minhas configurações** —
codinome e cor. É a única configuração a que o AGENTE tem acesso, e vale para
todos os cargos. Trocar o codinome ali muda o login junto: você passa a entrar
com o nome novo e a mesma senha.

O ADMIN também ajusta codinome e cor de qualquer conta, pelo ✎ nome/cor no
painel ⚙.

## Aviso no Discord

Mensagem que começa com **`/fukurou`** chama o bot: quem tem acesso ao canal
(menos o autor) recebe dele, no privado do Discord, o aviso abaixo (o texto se
troca na página do Fukurou). O prefixo sai da mensagem, que fica marcada com
🦉 no chat. Sem ele, ninguém é avisado.

> Sinal interceptado.... realidade não catalogada... verifique o sistema
> interno do CIT, uma nova mensagem lhe aguarda

Nunca vai o conteúdo, o canal ou o autor. O ID do Discord é obrigatório no
cadastro pelo código de acesso; depois, o agente troca em **minhas
configurações** e o ADMIN em **⌁ discord**, no painel ⚙ (o ✓ marca quem já
tem). Só o próprio agente e o ADMIN leem esse número. Cada `/fukurou` avisa
de novo, sem intervalo mínimo entre um e outro.

Não há servidor ligado: o gatilho `avisa_discord` (no `schema.sql`) escolhe os
destinatários e chama a Edge Function [`sinal`](supabase/functions/sinal/index.ts),
que fala com a API do Discord. Para ligar:

1. **discord.com/developers/applications** → *New Application* → aba **Bot** →
   *Reset Token* e guarde o token. Nenhum *Privileged Intent* é necessário.
2. Aba **OAuth2 → URL Generator**: marque `bot`, abra a URL gerada e adicione o
   bot ao servidor do RP. O Discord só deixa o bot abrir o privado de quem
   divide um servidor com ele.
3. Supabase → **Edge Functions** → *Deploy a new function* → *Via Editor*, nome
   `sinal`, cole o `index.ts` e publique. A verificação de JWT pode ficar
   ligada: o banco manda a chave anon junto.
4. **Edge Functions → Secrets**: crie `DISCORD_TOKEN` (o token do passo 1) e
   `SINAL_SECRET` (uma senha longa qualquer, inventada agora).
5. Rode o `schema.sql` de novo e, no SQL Editor, aponte o banco para a função
   com o mesmo segredo do passo 4 e a chave `anon` do `config.js`:

```sql
insert into discord_config (url, secret, anon_key)
values ('https://ptpujanpmynxdepmautq.supabase.co/functions/v1/sinal', 'O_MESMO_SEGREDO',
        'A_CHAVE_DO_CONFIG_JS')
on conflict (id) do update
  set url = excluded.url, secret = excluded.secret, anon_key = excluded.anon_key;
```

Desligar tudo: `delete from discord_config;`. Envios e falhas aparecem em
**Edge Functions → sinal → Logs**.

### Fukurou

Fukurou é o bot visto de dentro. Para MASTER, o botão 🦉 **Fukurou** aparece
logo abaixo de *Gerenciar usuários* e abre, depois da coruja, uma página só
dele:

- **na barra**, cada pessoa com quem o bot já falou no privado (nome no
  Discord, @usuário, ID e, se houver vínculo, o codinome no CIT);
- **em cada conversa**, o espelho do privado, das duas direções. O que você
  escreve ali chega no Discord como se fosse o Fukurou, e fica marcado no
  espelho com o seu codinome;
- **⚙ mensagem padrão**, o texto do aviso de mensagem nova, com uma prévia de
  como ele chega no Discord.

O Discord não avisa quando alguém responde ao bot (só entregaria isso a um
programa conectado o tempo todo), então o banco pergunta: o `pg_cron` chama a
função a cada 10 segundos, e uma resposta leva até isso para aparecer. São
cerca de 260 mil chamadas por mês, dentro das 500 mil do plano gratuito. Para
pausar: `select cron.unschedule('fukurou-escuta');` — rodar o schema de novo
religa.

## Sessão

O login fica no `sessionStorage`: sobrevive a F5 e à navegação normal, mas cai
quando o navegador é fechado — na volta, é preciso entrar de novo. Como o
`sessionStorage` é por aba, abrir o site numa aba nova também pede login.
Se o navegador estiver configurado para restaurar as abas ao iniciar, ele pode
devolver a sessão junto; para garantir a saída, use *Encerrar sessão*.

## Mensagens

- **Editar**: passe o mouse na mensagem e clique em ✎. O autor edita a própria;
  COMANDO e ADMIN editam a de qualquer um. Mensagens editadas ficam marcadas.
- **Apagar**: 🗑 ao lado do ✎. O autor apaga a própria; COMANDO e ADMIN apagam
  a de qualquer um. Some da tela de todo mundo na hora, e não há desfazer.
- **Enviar**: Enter. **Quebra de linha**: Shift+Enter.
- **Tamanho da caixa**: arraste a alça logo acima dela. A altura escolhida fica
  guardada; duplo clique na alça devolve o crescimento automático.

## Ambientação

Tudo abaixo respeita `prefers-reduced-motion` do sistema e some na impressão
do PDF. Os dois botões no rodapé da barra lateral ligam e desligam **♪ som** e
**▩ ruído de vídeo**; a escolha fica guardada naquele navegador.

- **Ruído de CRT** — de 9 em 9 a 30 segundos a tela dá uma "vacilada" de sinal,
  com uma faixa de imagem rasgada atravessando o vídeo, além de uma varredura
  lenta e contínua. É uma camada sobreposta que não captura clique.
- **Som** — estalo leve a cada tecla digitada (espaço mais grave, apagar mais
  abafado, afinação sorteada a cada toque), estalo firme ao enviar, bipe duplo
  ao chegar transmissão, tom grave na falha, alarme de três batidas no acesso
  negado, e um chiado de fundo em laço.
  Gerado na hora com Web Audio: nenhum arquivo, nenhuma requisição. O navegador
  só libera o áudio depois do primeiro clique ou tecla na página.
- **Chuva de caracteres** — só na tela de acesso, a ~18 fps, pausada quando a
  aba perde o foco e desligada ao entrar (atrás do chat ela disputava atenção
  com o texto).
- **Grade de dados** — atrás do chat, uma grade que desliza devagar com um pulso
  de luz subindo por ela de tempos em tempos. Feita só com CSS: sem canvas, sem
  timer, sem custo de bateria.
- **Texto que se decodifica** — nomes de canal e títulos de operação entram
  embaralhados e se resolvem letra a letra.
- **Linha de boot** — ao abrir um canal, uma linha de terminal digita o enlace
  sendo estabelecido e some sozinha.
- **Relógio e status** — hora com os dois-pontos piscando e indicadores de
  enlace, ruído e cifra na barra lateral.
- **Cursor de bloco** — piscando na caixa de mensagem quando ela está vazia.
- **Marca d'água** — carimbo diagonal ATIVA/ENCERRADA atrás do dossiê, também
  no PDF.

### Formatação

Vale em mensagens e em todos os campos dos dossiês.

| Escreva          | Vira              |
|------------------|-------------------|
| `**texto**`      | **negrito**       |
| `'texto'`        | *itálico*         |
| `*texto*` `_texto_` | *itálico*      |
| `__texto__`      | sublinhado        |
| `~~texto~~`      | ~~riscado~~       |
| `` `texto` ``    | `código`          |
| ` ```…``` `      | bloco de código   |
| `- item`         | tópico            |
| `1. item`        | lista numerada    |
| `> texto`        | citação           |
| `# Título`       | título            |
| `---`            | linha divisória   |
| `\|\|texto\|\|`  | spoiler (revela no clique) |
| `[[texto]]`      | tarja de censura (revela no clique) |
| `https://…`      | link              |

## Operações (dossiês)

O botão **⬢ CRIAR OPERAÇÃO** abre o formulário. Publicado, o dossiê aparece no
painel da direita — redimensionável pela alça e colapsável pelo botão ▤.

1. **TÍTULO DA OPERAÇÃO** (pisca, em destaque), com a luz de status ao lado
2. **INFORMAÇÕES** — Status, Data inicial, Horário, Local, Natureza da ocorrência
3. **ENVOLVIDOS** — Suspeitos, Agentes, Testemunhas, Vítimas
4. **RELATÓRIO**

O **Status** é *ativa* ou *encerrada*, e acende uma luz ao lado do título: verde
piscando enquanto a operação corre, vermelha fraca quando encerrada. A mesma luz
aparece na aba de cada dossiê, para ver o andamento sem abrir um por um.

Campos não preenchidos ficam em branco e podem ser completados depois em ✎ Editar.
Enquanto o chat corre na coluna da direita, **+ RELATO** (no cabeçalho da coluna
de relatos) ou **+ ADICIONAR RELATO** (na barra do dossiê) registram cada nova
apuração com os mesmos campos; nos relatos, **só o que foi preenchido aparece**.

Qualquer agente com acesso ao canal cria, edita e relata. Excluir a operação é do
criador e do COMANDO/ADMIN.

### Anexar imagens

O dossiê e cada relato aceitam imagens: pelo botão **+ Anexar imagem**, colando
com **Ctrl+V** ou arrastando o arquivo para a área tracejada. Até 8MB por
imagem. As miniaturas abrem em tamanho grande no clique e entram no PDF.

Os arquivos ficam num bucket privado do Supabase Storage, servidos por URL
assinada de 1 hora. A permissão de ver o anexo é a mesma de ver o canal onde a
operação está — quem não alcança o canal não abre a imagem nem com o endereço.

### Exportar em PDF

O botão **⎙ PDF** monta o dossiê inteiro — título, luz de status, os três blocos
e todos os relatos — num documento com o visual do site e abre a impressão do
navegador; escolha *Destino: Salvar como PDF*. O texto sai selecionável e
pesquisável, não é print de tela.

O fundo preto depende de `print-color-adjust: exact`, respeitado por Chrome,
Edge e Firefox. Se algum navegador ainda imprimir em branco, ligue
*Mais definições → Gráficos de plano de fundo* na caixa de impressão.

### Entidades

Suspeito, local, veículo, organização e qualquer informação identificável
deixaram de ser texto digitado dentro do dossiê. Cada um é uma **entidade** com
id próprio, cadastrada uma vez e reaproveitada: o mesmo homem citado em três
operações é uma linha só, com os três vínculos. É isso que deixa cruzar
operações com segurança — e é daí que a Teia de Vínculos é desenhada.

No formulário da operação, os campos **Local**, **Suspeitos**, **Agentes**,
**Testemunhas** e **Vítimas** não são mais caixas de texto: você busca a
entidade pelo nome ou apelido e escolhe, ou cadastra na hora pelo
*+ cadastrar “…” como entidade nova*. Ao lado de cada uma cabe um **papel**
("chefe", "capanga", "ponto de encontro"), que é o rótulo do vínculo na teia.
A mesma pessoa pode ser chefe numa operação e testemunha em outra sem virar
dois cadastros: o tipo é da entidade, o papel é da ligação.

Cada entidade tem tipo, nome, **sigla** (a legenda do nó no grafo), apelidos,
resumo, tags e imagens. A primeira imagem é a miniatura do nó. Ficam num bucket
privado próprio (`entidades`), servido por URL assinada de 1 hora.

**Possível duplicata**: ao digitar o nome, o site procura cadastro parecido —
por nome e por apelido — e avisa antes de você criar o segundo. A procura varre
o registro inteiro de propósito, inclusive entidades de operações que você não
alcança: duas fichas para a mesma pessoa quebrariam justamente o cruzamento que
a teia existe para fazer. O que o aviso mostra é só tipo, nome e apelido —
**nunca em que operação a entidade aparece**, nunca a foto, nunca o resumo.

**Sigilo**: a entidade herda o sigilo das operações em que aparece. Quem alcança
qualquer uma delas, a enxerga. A *ligação* entre entidade e operação é mais
fechada que a entidade: só aparece para quem lê o canal daquela operação. Na
prática, dois agentes podem ver a mesma ficha sem que nenhum descubra as
operações do outro. Quem decide é o RLS, no banco.

### Converter os dossiês antigos

Nada do que já estava escrito é apagado. Dossiê feito antes das entidades
continua mostrando o texto como sempre mostrou, com um botão dourado
**⇄ CONVERTER EM ENTIDADES** na barra do dossiê.

A conversão abre uma tela de revisão: o site lê o texto do dossiê **e dos
relatos dele**, quebra em trechos (vírgula, ponto-e-vírgula, linha, " e ") e
propõe uma entidade por trecho, já consultando o registro. Para cada um você
escolhe *usar o cadastro que existe*, *criar entidade nova* ou *ignorar — não é
entidade*; trecho repetido no dossiê e em vários relatos vira uma linha só. Nada
é convertido sem você confirmar.

Convertido o dossiê, os campos de texto antigos passam a ser **espelho** das
entidades: o banco os reescreve sozinho a cada vínculo criado, removido ou
renomeado. É por isso que o **Ctrl+F** e o **⎙ PDF** continuam funcionando sem
saber que o modelo mudou, e por isso um banco convertido pela metade nunca
mostra dossiê em branco. Quem manda passa a ser o vínculo; a coluna de texto é
só o reflexo dele.

Operação **nova já nasce com entidades** — ali o texto livre não existe mais.

## Teia de Vínculos

O quadro de investigação: cada coisa apurada é um **nó**, cada relação entre
duas é um **vínculo**, e a seção **Teia de Vínculos**, no topo da barra lateral,
dá duas visões dos mesmos dados — sem duplicar nada.

**◉ GERAL · FUKUROU** — tudo que você alcança, girando em torno do nó central
FUKUROU. Cada operação é um nó pendurado nele; as pessoas, locais, veículos e
demais entidades se ramificam a partir da operação em que foram apuradas.

**⬡ uma aba por operação** — só os nós daquela investigação, com a operação no
meio. A aba **aparece sozinha** quando a operação é criada, porque a lista sai
das operações que você enxerga, não de um cadastro à parte. Dentro dela, um
botão volta à Teia Geral.

A Teia Geral é **restrita**: ADMIN e MASTER entram sempre, os demais só por
concessão, feita no botão **ACESSO** dentro da própria página. A concessão abre
a porta, não derruba a parede — lá dentro o RLS continua valendo nó por nó, e
quem entra vê só as operações que já alcançava pelos canais. A aba individual
de uma operação segue o sigilo do canal dela: quem lê o canal, abre a aba.

### Lendo o quadro

A **forma e a cor** do nó dizem o tipo: pessoa em violeta, local em dourado,
veículo em azul, organização em ciano, informação em cinza, operação em ciano
no formato redondo. Sem foto, o nó mostra a sigla; com foto, a miniatura. Nó de
operação sigilosa vem com borda dupla vermelha.

A **cor da linha** diz o tipo do vínculo — comando, família, local/patrimônio,
financeiro, social — e o **traço** diz a confiança: cheio é *confirmado*,
pontilhado é *provável*, tracejado é *suposto*. Linha tracejada dourada é a
**conexão detectada automaticamente**: aquela entidade aparece em mais de uma
operação que você alcança.

- **Arrastar o nó** muda o lugar dele, e o lugar fica gravado para todo mundo
  que abre a mesma aba — é quadro de investigação, não arrumação pessoal.
- **Rolar** dá zoom; **arrastar o fundo** move a tela.
- **Clicar no nó** abre a ficha dele à direita (foto, galeria, resumo,
  apelidos, operações em que aparece e a lista de relacionamentos) e destaca
  todos os vínculos daquele nó, esmaecendo o resto do grafo. Clicar em um nome
  da lista de relacionamentos salta para aquele nó.
- **Duplo clique num nó de operação**, na Teia Geral, abre a aba dela.
- **Clicar no fundo** desfaz a seleção.

Na ficha de uma entidade que aparece em mais de uma operação sai o aviso
*conexão detectada automaticamente*, com as operações listadas — só as que você
alcança. As demais não entram na consulta, então não há o que esconder ali.

No dossiê, cada entidade vira uma ficha clicável nos campos de envolvidos:
clicar nela leva direto ao nó dela na teia.


### Criar e editar na própria teia

**⬢ CRIAR NÓ**, no cabeçalho, cadastra a entidade e já a amarra a uma operação
— na aba de uma operação, àquela; na Teia Geral, à que você escolher. Nó não
nasce solto de propósito: entidade sem operação nenhuma é rascunho que só o
autor enxerga, e é do vínculo com a operação que ele herda o sigilo.

**+ VÍNCULO**, na ficha de qualquer nó, liga dois nós da vista atual — e só
eles, porque o que está na tela é, por definição, o que você alcança. O vínculo
tem **tipo**, **rótulo** opcional e **nível de confiança**. O mesmo par não
entra duas vezes: tentar ligar de novo avisa que já existe e manda editar o que
está lá.

**Clicar numa linha** abre a ficha do vínculo, com observação, quem o criou e os
botões de editar e excluir (do autor e do COMANDO/ADMIN). Linha que o sistema
desenhou sozinho — entidade ligada à operação — não se edita ali: ela se desfaz
tirando a entidade do dossiê, em ✎ Editar.

**EXCLUIR NÓ**, na ficha da entidade, apaga o cadastro de todas as operações e
desfaz os vínculos dela de uma vez. É do autor e do COMANDO/ADMIN, e não há
desfazer.


### Conexões entre operações

Sempre que a **mesma entidade** passa a estar ligada a uma segunda operação,
as duas investigações se tocam. Isso aparece sozinho na Teia Geral — a entidade
vira nó com uma linha para cada operação, tracejada em dourado — e gera um
**aviso** para quem precisa saber.

O sino **⚑**, ao lado do seu codinome, acende com a contagem do que chegou. O
aviso diz:

> ⚠ CONEXÃO ENCONTRADA
> Um alvo de interesse foi identificado em outra operação.
> *Visualizar no grafo →*

E só. **Não diz o nome da entidade, nem as operações, nem traz foto ou resumo.**
É assim de propósito: o aviso vai para quem alcança *qualquer uma* das duas
operações, inclusive quem enxerga só um lado, e nomear o outro lado entregaria
a existência de uma operação sigilosa a quem não tem acesso a ela. O botão leva
ao grafo, e lá o RLS mostra exatamente o que aquele agente já podia ver. Quem
tem a Teia Geral cai nela com o nó selecionado; quem não tem cai na teia da
operação que alcança.

Regras:

- **Nunca duas vezes pela mesma conexão.** Entrando uma terceira operação, só
  os pares novos dela são avisados.
- **Quem criou o vínculo não é avisado** — ele viu acontecer.
- **Desfeito o vínculo**, a conexão some da Teia Geral (a linha é derivada, não
  gravada) e o estado dela é apagado. O aviso já dado fica: a caixa é histórico
  do que foi visto, não o estado atual.
- **Resolver exige os dois lados.** Na ficha da entidade, quem alcança as duas
  operações pode marcar a conexão como **confirmada** ou **ignorada** e deixar
  uma **observação**. Quem alcança só uma recebe o aviso, mas não vê o par.

A caixa de avisos é de quem recebeu e de mais ninguém — nem o ADMIN lê a caixa
alheia.

## Busca

**Ctrl+F** (ou o botão ⌕) varre mensagens, dossiês e relatos de **todos os canais que
aquele usuário acessa** — o RLS garante que nada fora disso aparece. Clicar em um
resultado abre o canal e salta até a mensagem ou dossiê.

## Manutenção

**Trocar o codinome de um agente** é do ADMIN, pelo ✎ nome no painel ⚙. Como o
login é derivado do codinome, o e-mail interno muda junto: o agente passa a
entrar com o nome novo e a mesma senha.

Promover alguém pelo SQL, se preciso:

```sql
update profiles set role = 'admin' where codename = 'Fulano';
```

Se o cadastro falhar com *Database error saving new user*, o código de acesso
digitado não existe em `invite_codes`.

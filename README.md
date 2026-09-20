# CIT · Paralela — comunicação anônima para RolePlay

Site estático (sem build). Backend: Supabase. Hospedagem: Vercel.

```
index.html   estrutura
style.css    visual
config.js    URL e chave anon do Supabase
format.js    formatação de texto (negrito, tópicos, etc.)
fx.js        ambientação: som, decodificação, relógio, chuva de caracteres
app.js       acesso, barra de canais, mensagens e edição
ops.js       dossiês de operação (painel lateral direito)
manage.js    gerenciar usuários (ADMIN) e criar canais/categorias (COMANDO)
search.js    varredura global (Ctrl+F)
schema.sql   banco de dados completo
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

| Código       | Cargo   | Pode                                                                 |
|--------------|---------|----------------------------------------------------------------------|
| `AGENTE`     | AGENTE  | ler/escrever nos canais liberados, criar e editar dossiês e relatos  |
| `COMANDOCIT` | COMANDO | tudo do agente + criar categorias e canais, editar mensagens alheias, remover agentes |
| `ADMIN!@#`   | ADMIN   | tudo do comando + criar/excluir contas, dar e tirar privilégios, trocar codinomes, redefinir senhas |

O cargo **não aparece no chat**: nada indica quais codinomes são de comando ou
admin. Só o painel ⚙ mostra isso, e só para o ADMIN.

Trocar um código:

```sql
update invite_codes set code = 'NOVO' where role = 'command';
```

A primeira conta ADMIN precisa ser criada pelo cadastro normal, usando `ADMIN!@#`.
Depois disso o ADMIN cria as demais contas pelo painel, sem distribuir códigos.

## Layout

Quatro colunas, todas **redimensionáveis** pelas alças entre elas e
**colapsáveis** pelo ✕ do cabeçalho ou pelos botões ▤ ▦ ▣ no topo da sala:

1. **Canais** — barra lateral com os canais e as configurações.
2. **Relatos** — a coluna larga, onde as apurações se acumulam. Do mais antigo
   no topo ao mais novo embaixo: rolar para cima é voltar no tempo.
3. **Dossiê** — as informações principais da operação.
4. **Transmissão** — o chat do canal.

No `# geral` só existe a transmissão: ele é canal de conversa, não tem dossiê.
Nos demais, relatos e dossiê **abrem sozinhos quando há operação** no canal e
ficam recolhidos quando não há — mexer no botão da coluna faz a sua escolha
passar a mandar, e criar uma operação devolve as duas ao automático.

As três de dentro da sala também **trocam de lugar**: arraste o punho ∷ do
cabeçalho de uma sobre a outra e solte à esquerda ou à direita dela. A barra de
canais é a exceção — fica sempre na ponta esquerda.

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
  *todos os agentes* ou *uma lista escolhida*. Um canal pode ficar dentro de uma
  categoria (herdando o acesso dela) ou avulso, com acesso próprio.

Quem cria entra automaticamente na lista de acesso. O ADMIN enxerga tudo.

**Reordenar**: quem tem COMANDO arrasta os itens da barra lateral — dá para pôr
uma categoria acima do `# geral`, mandar os canais individuais para baixo, mover
um canal para dentro de uma categoria (soltando sobre o nome dela) ou reordenar
os canais dentro dela. A ordem é a mesma para todo mundo. Como usa arrastar e
soltar do navegador, funciona no computador, não no toque.

Para **editar ou excluir**: o ✎ no topo do canal, e o ✎ ao lado do nome da
categoria na barra lateral. Excluir um canal apaga junto as mensagens e os
dossiês dele. Excluir uma categoria **não** esconde os canais dentro dela: eles
viram avulsos mantendo o mesmo acesso.

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
  ao chegar transmissão, tom grave na falha, e um chiado de fundo em laço.
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

### Exportar em PDF

O botão **⎙ PDF** monta o dossiê inteiro — título, luz de status, os três blocos
e todos os relatos — num documento com o visual do site e abre a impressão do
navegador; escolha *Destino: Salvar como PDF*. O texto sai selecionável e
pesquisável, não é print de tela.

O fundo preto depende de `print-color-adjust: exact`, respeitado por Chrome,
Edge e Firefox. Se algum navegador ainda imprimir em branco, ligue
*Mais definições → Gráficos de plano de fundo* na caixa de impressão.

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

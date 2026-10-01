# VGD · Vanguarda — prova e informes da unidade

Site estático (sem build). Backend: Supabase. Hospedagem: Vercel.

Irmão do CIT, que vive na raiz deste repositório — mesmo jeito de fazer as
coisas, **banco separado**. Nenhuma conta, nenhuma tabela e nenhum informe é
compartilhado entre os dois.

```
curso.sql    conteúdo do Curso de Modulação: canais, material e as questões
index.html   estrutura
style.css    visual (âmbar de painel, brasa de freio, xênon de farol)
config.js    URL e chave anon do Supabase da VGD
format.js    formatação de texto (negrito, tópicos, etc.)
fx.js        ambientação: som de motor, estrada de fundo, relógio e conta-giros
app.js       acesso, barra lateral, informes e edição
prova.js     a prova: fazer, corrigir e montar o banco de questões
manage.js    contas (ADMIN) e criação de categorias/canais (COMANDO)
search.js    varredura global (Ctrl+F)
schema.sql   banco de dados completo
```

## Setup

1. Crie um projeto **novo** em supabase.com — não reaproveite o do CIT.
2. **Authentication → Providers → Email**: desligue *Confirm email* (as contas
   usam e-mails fictícios derivados do nome do personagem).
3. **SQL Editor**: cole o `schema.sql` inteiro e rode. Ele é **idempotente** —
   rode de novo a cada atualização do site, sem perder dados.
4. **Project Settings → API**: copie *Project URL* e *anon public key* para o
   `config.js`.
5. **SQL Editor**: cole o `curso.sql` e rode. Ele cria os canais do curso, o
   material de estudo e a prova teórica. Também é idempotente — rodar de novo
   atualiza as questões e refaz a lista de quem instrui, sem duplicar nada.
6. Cadastre os códigos de acesso (abaixo).
7. No Vercel: *Add New Project* → importe este mesmo repositório →
   **Root Directory: `vgd`** → Framework *Other*, sem build command.

> A chave `anon` pode ficar no código: a segurança vem das regras de RLS do
> `schema.sql`.

## Cargos

| Cargo     | Pode                                                                 |
|-----------|----------------------------------------------------------------------|
| CANDIDATO | só a prova. Não enxerga informe nenhum — nem na tela, nem pelo banco |
| OFICIAL   | ler e publicar nos canais liberados                                  |
| COMANDO   | tudo do oficial + corrigir provas, montar o banco de questões, criar categorias e canais, editar informe alheio |
| ADMIN     | tudo do comando + criar/excluir contas, dar e tirar cargos, trocar nomes, redefinir senhas, mexer na nota de corte |

A aprovação na prova promove o candidato a OFICIAL automaticamente — é o que
abre os informes para ele.

## Códigos de acesso

Digitados uma única vez, no cadastro. Definem o cargo da conta.

**Eles não estão neste repositório.** Vivem só na tabela `invite_codes`, no
banco, que é privado. Este repositório é público: um código escrito aqui é um
código entregue a quem abrir a página do projeto — e o histórico do git não
esquece.

Cadastrar o código que os candidatos vão usar, no SQL Editor:

```sql
insert into public.invite_codes (code, role) values ('SEU_CODIGO_AQUI', 'candidato')
  on conflict (code) do update set role = excluded.role;
```

Ver os que estão valendo, trocar ou aposentar:

```sql
select role, code from invite_codes order by role;
update public.invite_codes set code = 'NOVO' where role = 'comando';
delete from public.invite_codes where code = 'ANTIGO';
```

Na primeira vez que o `schema.sql` roda num banco vazio, ele cria sozinho um
código de ADMIN aleatório — é por ele que nasce a primeira conta:

```sql
select code from public.invite_codes where role = 'admin';
```

Leia-o uma vez, crie sua conta e troque por um seu.

## Cargos

Duas coisas diferentes convivem aqui, e confundi-las é o erro fácil:

- **Credencial** (`profiles.role`) — a escada de permissão do site: candidato →
  oficial → comando → admin. Manda no que cada um **pode fazer**.
- **Cargo** (tabela `cargos`) — etiqueta nomeada e colorida que o ADMIN pendura
  numa conta: Instrutor, Patrulheiro, Mecânica. Manda em **onde se entra**.

Um canal ou categoria pode ser liberado para um cargo inteiro, e aí entra quem
o tiver — sem lista de nome por nome, e sem precisar promover ninguém. A
liberação por cargo vale independentemente da credencial: é a ferramenta para
abrir uma exceção precisa, inclusive para um candidato.

O ADMIN cria e distribui cargos no painel ⚙ *Contas*; o botão **◈ cargos** de
cada conta abre as caixas de marcar. Dar ou tirar um cargo muda o que a pessoa
enxerga na hora, sem recarregar.

## Quem vê o quê

O candidato não é um oficial de segunda classe: ele é alguém de fora que
precisa estudar. A porta que decide isso é a marca **"abrir também a
candidatos"**, na categoria ou no canal (coluna `candidatos`).

| Onde | Quem alcança |
|------|--------------|
| `#prova-teórica` | candidato e quem já prestou |
| categoria **ACADEMIA** — páginas 1 a 4 do curso | todos, inclusive candidatos |
| `#mural` e os canais da unidade | só a partir de OFICIAL |
| categoria **INSTRUÇÃO** — prova prática, gabarito, critérios | COMANDO e ADMIN |
| `#resultados` | ADMIN |
| qualquer canal liberado para um **cargo** | quem tiver o cargo |

O gabarito é o ponto sensível da coisa toda: ele vive na categoria INSTRUÇÃO,
na coluna `correct` de `exam_questions` e na `rubrica` da mesma tabela. O
candidato não alcança nenhum dos três — ele lê as questões pela view
`exam_questions_public`, que não traz essas colunas. Nem depois de entregar o
navegador dele recebe o gabarito.

Os canais de material são **somente leitura**: só COMANDO e ADMIN publicam
neles. É a coluna `somente_leitura`, com a regra em `pode_escrever()`.

> O PDF do curso **não entra neste repositório** — ver o `.gitignore` da pasta.
> As últimas páginas dele são o gabarito, e a pasta inteira vira URL na Vercel.

## A prova

A correção é automática e acontece na entrega, dentro do banco:

- **Objetivas** — compara a alternativa marcada com o gabarito.
- **Abertas** — roda a `rubrica` da questão sobre o texto, critério por
  critério. A rubrica é a tradução literal do que o PDF descreve em prosa
  ("abertura QAP Central, 1; unidade correta, 1; ID do P2 correto, 1; ..."):
  cada critério tem um peso e uma expressão regular. O que bateu e o que não
  bateu fica gravado em `exam_answers.criterios`, e o ADMIN vê a conta aberta
  em vez de um número solto.
- **Dissertativas** — continuam existindo para quem quiser criar uma pelo
  painel; ficam em zero esperando a nota à mão.

A prova sai da entrega como **aguardando**, com a nota já calculada. No canal
`#resultados` aparece `Nota 79.17% — Recomendação: Aprovar`, e aí:

- **Aprovar** → a conta vira OFICIAL, e o mural e os canais da unidade abrem.
- **Reprovar** → **a conta é apagada**, com a prova e as respostas. Duas
  exceções, para o botão não virar uma arma: conta de ADMIN nunca é removida, e
  ninguém remove a si mesmo. O resultado é copiado para `exam_log` antes de
  apagar, então a unidade não perde a memória de quem prestou e de quem
  decidiu o quê.

A nota é recomendação, não veredito: quem decide é o ADMIN, com as respostas e
os critérios à frente.

Cada candidato tem **uma tentativa**; uma segunda exige *Liberar nova
tentativa*, no mesmo painel. Enquanto a prova não é entregue, as respostas
ficam no `localStorage` do navegador dele — fechar a aba e voltar não perde
nada, e elas só chegam ao banco na entrega.

Montar a prova: painel ≡ *Banco de questões*. Questão desativada sai da prova
sem apagar o histórico de quem já respondeu a ela.

### A prova que veio do PDF

O material entregue (*Curso de Modulação Policial*, DPP) está incompleto: diz
ter 15 questões e traz 8 — faltam a 3, 5, 7, 9, 13, 14 e 15, e o gabarito lista
8 letras para 10 objetivas. O `curso.sql` semeia as que existem, somando **48
pontos**. O corte continua percentual (70%, como o curso manda), então a conta
fecha mesmo com a prova mais curta; acrescentando as que faltam pelo Banco de
Questões, o total sobe sozinho.

O item b) da questão 11 foi reconstruído a partir do gabarito e da estação 2,
que trazem os dados que faltavam no caderno do aluno.

## Identidade

Aqui não existe codinome — ao contrário do CIT. O oficial é conhecido pelo
**nome do personagem no RP**, e é dele que sai o login: o nome vira um `handle`
(minúsculas, sem acento, pontos no lugar de espaço) e o `handle` vira o e-mail
interno da conta.

O cálculo acontece nos dois lados: em `handle_do_nome()`, no `schema.sql`, e em
`handleDe()`, no `app.js`. Os dois têm de dar exatamente o mesmo resultado —
mexer num obriga a mexer no outro, ou o login para de encontrar a conta.

Trocar o nome de alguém (painel de contas) troca junto o e-mail interno: dali
em diante a pessoa entra com o nome novo e a senha antiga.

## Ambientação

- Três cliques seguidos no tigre e a tela dá uma passada de nitro.
- O botão ▩ desliga tudo que custa quadro o tempo todo — listras, estrada,
  varredura de CRT. É o que usar em máquina fraca ou com o site aberto dentro
  do jogo, onde navegador e jogo dividem a mesma GPU.
- O botão ♪ desliga o som. Tudo é sintetizado na hora, sem baixar arquivo.

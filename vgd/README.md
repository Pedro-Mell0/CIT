# VGD · Vanguarda — prova e informes da unidade

Site estático (sem build). Backend: Supabase. Hospedagem: Vercel.

Irmão do CIT, que vive na raiz deste repositório — mesmo jeito de fazer as
coisas, **banco separado**. Nenhuma conta, nenhuma tabela e nenhum informe é
compartilhado entre os dois.

```
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
5. Cadastre os códigos de acesso (abaixo).
6. No Vercel: *Add New Project* → importe este mesmo repositório →
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

## A prova

Mista: objetivas e dissertativas na mesma prova.

- As **objetivas** são corrigidas na hora, dentro do banco. O gabarito mora na
  coluna `correct` de `exam_questions`, que o candidato não alcança: ele lê as
  questões pela view `exam_questions_public`, que não traz essa coluna. Nem
  depois de entregar o navegador dele recebe o gabarito.
- As **dissertativas** vão para o painel ✓ *Correção de provas*, onde o comando
  dá os pontos de cada uma e bate o martelo.
- O veredito é do comando, não da aritmética: a nota de corte é referência, e
  aprovar ou reprovar é um botão à parte.
- Cada candidato tem **uma tentativa**. Uma segunda exige *Liberar nova
  tentativa*, no mesmo painel.
- Enquanto a prova não é entregue, as respostas ficam no `localStorage` do
  navegador do candidato: fechar a aba e voltar não perde nada. Elas só chegam
  ao banco na entrega.

Montar a prova: painel ≡ *Banco de questões*. Questão desativada sai da prova
sem apagar o histórico de quem já respondeu a ela.

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

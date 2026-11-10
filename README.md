# DPP · Departamento de Polícia de Paralela

Ferramentas web de apoio à polícia no **Paralela Roleplay**, um servidor de GTA RP
(FiveM) de proposta *Hard RP*. Nada aqui é jogo: são sites usados **fora** do
jogo pelo efetivo policial, para organizar o trabalho que acontece **dentro**
dele — investigações, informes, cursos e provas.

O repositório reúne as unidades do departamento. Cada uma é um site estático
(sem build) com seu próprio banco Supabase e seu próprio projeto na Vercel.
Nenhuma conta, tabela ou mensagem é compartilhada entre elas.

| Pasta          | Unidade                  | O que faz |
|----------------|--------------------------|-----------|
| [`cit/`](cit/) | **CIT** · unidade investigativa | Comunicação anônima entre agentes, dossiês de operação, cadastro de entidades e a Teia de Vínculos entre investigações. |
| [`vgd/`](vgd/) | **VGD** · Vanguarda      | Unidade de acompanhamentos com viaturas especializadas: informes da unidade, material do Curso de Modulação e a prova teórica. |

Cada pasta tem seu próprio README com setup, banco e regras de uso.

## Documentos do servidor

Na raiz ficam, como contexto, os três documentos oficiais que regem o RP da
cidade e da polícia:

- **REGULAMENTO INTERNO DA POLÍCIA PARALELA.pdf** — história, hierarquia,
  conduta, procedimentos operacionais e disciplina do efetivo.
- **CÓDIGO PENAL DE PARALELA.pdf** — infrações, penas e multas aplicáveis aos
  cidadãos.
- **REGRAS E TERMOS DA CIDADE — PARALELA ROLEPLAY.pdf** — termos de uso do
  servidor e regras de roleplay, incluindo as fichas técnicas de cada ação
  (participantes, armamento, reféns, fuga limpa, Código 5 etc.).

> Os PDFs **não sobem para o GitHub** (ver `.gitignore`): este repositório é
> público e o Regulamento é de uso restrito ao efetivo policial. Eles existem
> só na cópia local da pasta.

## Hospedagem

Dois projetos na Vercel apontando para este mesmo repositório, cada um com o
seu *Root Directory*:

| Projeto Vercel | Root Directory |
|----------------|----------------|
| `cit00`        | `cit`          |
| `vgd00`        | `vgd`          |

A raiz do repositório não é um site: nenhum projeto deve apontar para ela.

> Não ponha um `vercel.json` na raiz. A Vercel o lê mesmo nos projetos com
> *Root Directory* numa subpasta — um `ignoreCommand` aqui já cancelou o
> deploy da VGD.

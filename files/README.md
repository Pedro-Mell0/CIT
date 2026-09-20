# CIT · Paralela — chat anônimo

Site estático (sem build). Backend: Supabase (gratuito). Hospedagem: Vercel.

## Setup
1. Crie um projeto em supabase.com.
2. **Authentication → Providers → Email**: desligue "Confirm email" (os agentes usam e-mails fictícios `codinome@cit.paralela`).
3. **SQL Editor**: cole o `schema.sql` e rode. Antes, troque os dois códigos de acesso no final do arquivo.
4. **Project Settings → API**: copie *Project URL* e *anon public key* para o `config.js`.
5. Suba para o GitHub e importe no Vercel (Framework: *Other*, sem build command).

## Uso
- Distribua o **código de agente** para os agentes e o **código de comando** só para o comando.
- Cadastro: codinome + senha + código de acesso. Depois, só codinome + senha.
- Agente vê `# geral` e o próprio canal individual. Comando vê tudo.
- Trocar um código: `update invite_codes set code = 'NOVO' where role = 'agent';`
- Promover/rebaixar alguém: `update profiles set role = 'command' where codename = 'Fulano';`

# QR Manager

Painel privado para criação, gestão e download de QR Codes dinâmicos. Em modo local, os registros ficam no `localStorage`; com Supabase configurado, autenticação e registros passam a ser compartilhados. Os links públicos usam hash routing e funcionam em hospedagem estática.

## Executar localmente

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

Sem variáveis Supabase, o app usa dados e login de demonstração (`admin@qrmanager.local` / `admin123`). Esse modo serve apenas para testar no mesmo navegador; não funciona para scans públicos ou entre dispositivos.

Registros criados nesse modo ficam no navegador e não são migrados automaticamente para o Supabase. Recrie-os no painel depois de configurar o projeto compartilhado; os QR Codes baixados localmente apontam para `localhost` e também devem ser gerados novamente após publicar.

## Configurar Supabase

1. Crie um projeto Supabase e um usuário administrador em **Authentication > Users**. Desative novos cadastros públicos.
2. Em **Authentication > URL Configuration**, defina **Site URL** com a URL local mostrada pelo Vite (por exemplo, `http://localhost:5174`) e adicione a mesma origem às **Redirect URLs** (por exemplo, `http://localhost:5174/**`). O convite usa esse endereço para retornar ao app.
3. Execute [supabase/schema.sql](supabase/schema.sql) no SQL Editor do projeto.
4. Inclua o ID do usuário administrador em `qr_admins`, substituindo o e-mail:

```sql
insert into public.qr_admins (user_id)
select id from auth.users where email = 'admin@example.com'
on conflict do nothing;
```

5. Copie [.env.example](.env.example) para `.env.local` e defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
6. Reinicie `npm run dev`, aceite o convite e defina uma senha na tela do QR Manager.

A chave publishable/anon é apropriada para uso no navegador com as políticas RLS deste schema. **Nunca** use ou publique uma `service_role` key.

## Publicar no GitHub Pages

1. Envie o projeto para a branch `main` de um repositório GitHub.
2. Em **Settings > Pages**, escolha **GitHub Actions** como fonte.
3. Em **Settings > Secrets and variables > Actions > Variables**, crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` com os valores do Supabase.
4. Execute o workflow **Deploy to GitHub Pages** ou faça push para `main`.

O workflow exige as duas variáveis e falha se elas estiverem ausentes. A URL dos QR Codes é construída com o caminho publicado do site, inclusive em repositórios com subpath. Depois que o site estiver online, gere e baixe novamente os PNGs que foram criados localmente, pois eles apontam para `localhost`.

## Recursos

- Login privado por Supabase Auth
- CRUD de QR Codes com políticas RLS para administradores cadastrados
- Resolução pública por código através da função `resolve_qr_code`, sem leitura pública da tabela
- Contagem de scans no banco
- Criação individual, em lote e por CSV
- Busca, filtros, ativação, edição e exclusão
- Download PNG individual e ZIP, além de exportação CSV

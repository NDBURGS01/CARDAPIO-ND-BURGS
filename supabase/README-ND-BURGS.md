# Servidor central — MESTRE DA CHAPA ND BURGS

Este backend usa o projeto Supabase já existente: `pvvnjmbcznkiilfiomlo`.

## O que armazena
- Cadastro autenticado por telefone (OTP/SMS).
- Perfil, pontos, XP, nível, recorde e partidas.
- Histórico de pontos.
- Skins desbloqueadas.
- Missões diárias com resgate único por dia.
- Cupons únicos, validade de 30 dias e controle de utilização.
- Ranking central.
- Validação administrativa de cupons.

## Arquivos
- `migrations/202611280001_fidelidade_ndburgs.sql`: tabelas, políticas e operações transacionais.
- `functions/game-api/index.ts`: API autenticada do jogo.

## Implantação necessária
1. No Supabase, abra o projeto `pvvnjmbcznkiilfiomlo`.
2. Entre em SQL Editor, cole e execute o conteúdo da migration.
3. Ative Phone Auth em Authentication > Providers > Phone e configure um provedor SMS.
4. Publique a Edge Function `game-api` com Supabase CLI.
5. Configure secrets `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` na função. Nunca coloque a service-role key no GitHub ou no HTML.
6. Cadastre o primeiro administrador: depois de autenticar esse telefone no jogo, altere o campo `role` do respectivo `game_profiles` para `admin`, pelo painel SQL.
7. Configure no jogo a URL do projeto e a chave pública anon/publishable. A chave pública pode ficar no frontend; a service-role key não.

## Endpoints da função
POST `/functions/v1/game-api` com Bearer JWT do cliente e JSON:
- `{"action":"profile"}`
- `{"action":"rename","display_name":"Nome"}`
- `{"action":"start"}`
- `{"action":"finish","session_id":"UUID","score":120,"caught":15}`
- `{"action":"redeem","discount_percent":5}`
- `{"action":"validate_coupon","code":"ND5-..."}` (somente administrador)
- `{"action":"leaderboard"}`

## Observação de segurança
O banco e a API impedem escrita direta de pontos pelo navegador, duplicação de resgate de missão e reutilização de cupom. A pontuação ainda é informada pelo cliente do jogo; os limites e a sessão reduzem abuso, mas não equivalem a uma validação criptográfica de cada movimento. A proteção antifraude pode ser reforçada com telemetria de eventos e limites de frequência após os primeiros testes.

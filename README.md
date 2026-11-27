# ND BURGS GESTÃO

Novo projeto separado da loja pública. Publicação estática no GitHub Pages; autenticação, dados e permissões no Supabase.

## 1. Criar o repositório
Crie um repositório novo no GitHub, por exemplo `nd-burgs-gestao`. Envie todo o conteúdo desta pasta para a raiz do repositório. Ative GitHub Pages em **Settings → Pages → Deploy from a branch → main → /(root)**.

## 2. Configurar Supabase
O projeto usa o Supabase já existente da loja (`https://pvvnjmbcznkiilfiomlo.supabase.co`) para compartilhar a base, desde que você confirme que esse é o projeto correto. No SQL Editor, execute `supabase/migrations/001_schema.sql`.

Na `assets/app.js`, substitua:
- `COLOQUE_A_URL_DO_SEU_SUPABASE`
- `COLOQUE_A_CHAVE_PUBLICAVEL_DO_SUPABASE`

Use somente a chave publicável/anon no navegador. **Nunca coloque service_role/secret key no GitHub.**

## 3. Criar os usuários
No Supabase → Authentication → Users, crie os usuários (ADMIN, ATENDIMENTO, SABRINA e MOTOBOY). Copie o UUID de cada usuário e insira no SQL Editor, ajustando os dados:

```sql
insert into public.profiles (id, full_name, role, active) values
('UUID-ADMIN', 'Administrador', 'admin', true),
('UUID-ATENDIMENTO', 'Atendimento', 'attendant', true),
('UUID-SABRINA', 'Sabrina', 'stock', true),
('UUID-MOTOBOY', 'Motoboy', 'driver', true);
```

Não use PIN/senha compartilhada no código. Cada pessoa deve ter login próprio.

## 4. Ativar pedidos da loja no painel
A função pública segura fica em `supabase/functions/create-order/index.ts`.
Instale/abra o Supabase CLI, faça login e rode:

```bash
supabase link --project-ref pvvnjmbcznkiilfiomlo
supabase functions deploy create-order
```

A função usa `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` como secrets gerenciados pelo Supabase. Não os copie para HTML.

O checkout da loja deve enviar `POST` para:
`https://pvvnjmbcznkiilfiomlo.supabase.co/functions/v1/create-order`

Headers:
`Content-Type: application/json`
`apikey: SUA_CHAVE_PUBLICAVEL`

JSON esperado:
```json
{
  "customer_name":"Nome",
  "phone":"11999999999",
  "delivery_type":"ENTREGA",
  "street_name":"AV BRASIL",
  "street_number":"123",
  "address":"AV BRASIL, 123",
  "payment_method":"PIX",
  "items":[{"product_name":"X-Burg","quantity":1,"unit_price":25.9,"notes":""}]
}
```
A função recalcula a taxa consultando `delivery_fees`; não confia na taxa enviada pelo navegador. Depois de gravar o pedido e os itens, o painel recebe a mudança em tempo real.

## 5. Taxas de entrega
A tabela `delivery_fees` é a base compartilhada. Cadastre as ruas e trechos nela. Regras já confirmadas para inserir:

```sql
insert into public.delivery_fees(street_name,region,fee) values
('ESTRADA DO PADRE INÁCIO COMEÇO','',4.00),
('ESTRADA DO PADRE INÁCIO FIM','',4.00),
('AV BRASIL','',5.00),
('RUA COMODORO','',5.00),
('ESTRADA DO MORRO GRANDE COMEÇO','',6.00),
('ESTRADA DO MORRO GRANDE FINAL','',8.00),
('RUA MONTE SINAI','JARDIM CARMEL',6.00),
('RUA DR. CAIO SIMÕES','JARDIM CARMEL',6.00),
('IOLANDO SAVIOLI','JARDIM CARMEL',6.00)
on conflict(street_name) do update set region=excluded.region,fee=excluded.fee,active=true;
```

Importe as demais ruas da planilha de taxas atualizada antes de liberar o checkout. Não apague as ruas já existentes sem conferir.

## O que já está neste pacote
- Login Supabase Auth e leitura do perfil/permissões.
- Painel responsivo Black Lime com menu por perfil.
- Visão geral, quadro Kanban e atualização de status de pedidos.
- Listagem de pedidos e exportação CSV.
- Inventário com quantidades limitadas de 0 a 100.
- Cadastro/edição de taxas.
- Tela inicial de motoboys/localizações.
- Estrutura SQL para pedidos, itens, taxas, perfis, localização, estoque, movimentos, expediente, caixa, confirmação de pagamento, rotas e auditoria.
- Edge Function para receber pedidos do site e calcular a taxa no servidor.

## Atenção — etapa de implantação
Este é o primeiro pacote web independente e a base de integração. Não é uma migração automática de todos os comportamentos do Apps Script antigo. Antes de operar em produção, ainda precisam ser concluídos e testados os fluxos avançados: roteirização no mapa, GPS contínuo do motoboy, expediente associado a cada pedido, fechamento financeiro por turno, sangrias/despesas, recibo de cartão, impressão, notificações e migração/importação completa das taxas. O painel não deve ser usado para fechamento oficial até esses módulos serem implementados e validados.

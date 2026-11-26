# Piloto na Cloudflare

- Endereço: https://escala-gm-piloto.pietrodienstmann.workers.dev
- Worker: `escala-gm-piloto` · Banco D1: `escala-gm-piloto`
- Login: nome + senha (segredo `SENHA` do Worker). Cookie assinado com o segredo `SEGREDO`.

## Trocar a senha

Painel da Cloudflare → Workers e Pages → `escala-gm-piloto` → Configurações → Variáveis e segredos → `SENHA` → editar.
Ou: `echo -n 'nova-senha' | npx wrangler secret put SENHA`.
Para derrubar todas as sessões abertas, troque também o `SEGREDO`.

## Publicar de novo

```bash
cd prototipo/servidor
npm install
CLOUDFLARE_API_TOKEN=... npm run deploy        # gera a página e publica o Worker
```

Mudança de estrutura do banco: edite `schema.sql` e aplique com
`npx wrangler d1 execute DB --remote --file schema.sql` (nunca dentro de uma requisição).

## Rodar localmente

```bash
printf 'SENHA="teste"\nSEGREDO="qualquer-texto-longo"\n' > .dev.vars
npm run dev      # http://127.0.0.1:8787, banco D1 local
```

## Como os dados são salvos

- `registros`: GMs e lançamentos (um JSON por linha).
- `docs`: postos, seções, equipes, configurações e cadastro de REQ.
- `meta.revisao`: número da revisão + id do último comando. Cada alteração envia a revisão que a tela conhece;
  se outra pessoa salvou antes, o banco recusa (409) e a tela recarrega a versão nova.
- `eventos`: histórico de quem alterou o quê. Triggers impedem alterar ou apagar.

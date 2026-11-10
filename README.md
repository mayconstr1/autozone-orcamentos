# Gerador de orçamentos AutoZone

Gerador de orçamentos para clientes da loja AutoZone 7626. Gera um PDF com a logo, calcula preço bruto e líquido, desconto, parcelamento e a mensagem ao cliente. Não tem login e não guarda dados de clientes.

O site está hospedado na Vercel.

A busca por placa é opcional e usa a rota `/api/placa`. Configure as variáveis no projeto da Vercel. Nunca coloque chaves no código nem no repositório.

- `PLATE_PROVIDER` — `apiplacas`, `dadosapi` ou `fraga`
- `PLATE_API_KEY` — token do provedor. No Fraga, é a senha da conta
- `FRAGA_USER` — e-mail da conta do Catálogo Fraga. Obrigatório só com `PLATE_PROVIDER=fraga`

Exemplo Fraga: `PLATE_PROVIDER=fraga`, `FRAGA_USER` com o e-mail e `PLATE_API_KEY` com a senha. Sem isso, a API responde que a busca não está configurada e o formulário pede o preenchimento manual.

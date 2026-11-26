# Protótipo — Escala GM

Prova de conceito do novo modelo de escala: **escala do dia = escala ideal + lançamentos**.
Nada é copiado para os dias; a escala de cada data, os furos e o livro de horas são calculados.

- `engine.js`: motor (regimes 12x36 e semanal, folgas, afastamentos, HE, BH, trocas, remanejamentos, FA de viatura, furos, sugestão de GM, livro de HE com teto de 60h e transporte para o mês seguinte).
- `engine.test.mjs`: testes com casos reais (noite que atravessa a data, HE fixa da escala semanal, teto de 60h, troca, FA...).
- `comando.js` + `comando.test.mjs`: lançamento rápido por texto ("folga kraemer 28/11", "he couto hoje 19-01 vtr 1317 req 1504").
- `seed.js`: dados de exemplo com nomes fictícios.
- `app.js` + `index.html`: telas (semana com cobertura e pendências, quadro do dia, lançamentos, mês e horas, ficha do GM, folha em ofício, ajustes).

Edição direta no quadro, como planilha: clicar no nome troca o GM (pergunta o motivo: troca, folga, falta, atestado, compensação), clicar no horário muda a hora (o que passa do horário normal vira HE sozinho), "+ pôr GM" coloca alguém (reserva primeiro, depois HE). "Preencher sozinho" propõe a cobertura do dia ou da semana para conferir e confirmar.

Regras: reserva técnica é um posto que não gera furo e é a primeira opção para cobrir faltas (remanejar, sem HE); a alternância 12x36 vem de um único dia de referência configurável em Ajustes.

```bash
node --test prototipo/engine.test.mjs prototipo/comando.test.mjs   # testes
node prototipo/build.mjs                # gera prototipo/escala-gm.html (arquivo único)
```

Abra `prototipo/escala-gm.html` direto no Chrome. Os lançamentos ficam salvos no navegador (localStorage).
Na aba **Folha**, use Ctrl+P para gerar o PDF (papel ofício, frente e verso).

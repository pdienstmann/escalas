# Protótipo — Escala GM

Prova de conceito do novo modelo de escala: **escala do dia = escala ideal + lançamentos**.
Nada é copiado para os dias; a escala de cada data, os furos e o livro de horas são calculados.

- `engine.js`: motor (regimes 12x36 e semanal, folgas, afastamentos, HE, BH, trocas, remanejamentos, FA de viatura, furos, sugestão de GM, livro de HE com teto de 60h e transporte para o mês seguinte).
- `engine.test.mjs`: testes com casos reais (noite que atravessa a data, HE fixa da escala semanal, teto de 60h, troca, FA...).
- `seed.js`: dados de exemplo com nomes fictícios.
- `app.js` + `index.html`: telas (quadro do dia, lançamentos, mês e horas, ficha do GM, folha para impressão).

```bash
node --test prototipo/engine.test.mjs   # testes do motor
node prototipo/build.mjs                # gera prototipo/escala-gm.html (arquivo único)
```

Abra `prototipo/escala-gm.html` direto no Chrome. Os lançamentos ficam salvos no navegador (localStorage).
Na aba **Folha**, use Ctrl+P para gerar o PDF.

# Melhorias e roteiro de evolucao

Este arquivo transforma a revisao de UX em trabalho executavel. Nenhuma etapa deve remover funcoes ja existentes, alterar a regra dos quatro turnos ou fazer um GM desaparecer da escala.

## Regras permanentes

- Preservar a data aberta ao trocar de modulo e manter filtros relevantes por modulo/data.
- Priorizar acao direta na grade: clicar, arrastar e soltar; painel ou dialogo servem para detalhes.
- Separar jornada regular de extensao independente de HE.
- Moto exige somente condutor; viatura convencional inicia com motorista e patrulheiro, mas pode ter reforcos.
- Um GM removido de posto ou VTR vai para disponiveis/remanejamento, nunca some.
- PDF nao pode exibir botoes, campos de edicao ou controles do aplicativo.
- Validar em celular 360/390/430 px, tablet 768/1024 px e desktop 1366/1920 px.

## 1. Navegacao e estado entre abas

### Concluido

- Navegacao client-side, prefetch, feedback de transicao e fallback seguro.
- Data `?date=` preservada entre modulos; data e posicao da grade sao restauradas.
- Cache curto por modulo e respostas atrasadas ignoradas no planejamento.
- Estado de filtros e pagina corrente salvo por modulo/data em Pendencias e Historico.

### Pendente

- Persistir busca, filtros, ordenacao, pagina e secoes abertas por modulo/data.
- Avisar antes de sair de formulario com alteracao nao salva.
- Centralizar o feedback de navegacao para preservar dados visiveis durante sincronizacao.

## 2. Dialogos, filtros e botoes

### Concluido

- Dialogos com cabecalho, descricao, fechar, salvar/cancelar e limites de altura na maioria dos modulos.

### Pendente

- `AppDialog` reutilizavel com foco inicial, ciclo de Tab, tecla Esc, travamento de rolagem e folha inferior no celular.
- Ainda criar `MobileSheet`, `FilterBar` e `ActionButton` para concluir a padronizacao visual.
- Converter dialogos antigos gradualmente sem interromper fluxos existentes.

## 3. Escala diaria

### Concluido

- Quatro turnos lado a lado, diferenca dia/noite, drag-and-drop, copia, remocao parcial, HE independente, BH, remanejamento, desfazer e sugestoes inteligentes.
- Modos compacto e detalhado preservam nome, funcao, horario, indicadores e requerimento.
- O cartao exibe somente a acao principal de HE; ajuste e acoes secundarias ficam no menu contextual recolhido.
- Arraste usa sombra do GM, linha de insercao, cancelamento com Esc e confirmacao curta apos salvar.
- As duas metades regulares seguem juntas quando pertencem ao mesmo GM, periodo e recurso; HE independente continua separada.
- Regras de conflito revisadas: jornada regular nao absorve extensao independente; remanejamento parcial preserva o outro bloco; copia fora da carga normal nasce como HE.

### Pendente

- Executar validacao visual assistida com usuarios em escalas reais especialmente densas, preservando as regras automatizadas acima.

### GMs de grupamentos na escala diaria

- Os cartoes de grupamentos usam as mesmas acoes contextuais da escala: ajustar, trocar, BH, copiar, detalhes, remover segmento e extensao de HE.
- O menu contextual inclui `HE do grupamento`: limita as sugestoes inteligentes aos integrantes do mesmo grupamento e preserva a regra de equipe/dia oposto.

## 4. Pendencias e afastamentos

### Concluido

- Filtros, busca, agrupamento por tipo, pagina local de 50 registros, cadastro em sequencia e integracao automatica com escala.

### Pendente

- Paginacao remota concluida com `page`, `pageSize`, `type`, `query`, `dateFrom`, `dateTo` e totais por tipo.
- Filtros rapidos ativos na data, futuros e encerrados; tambem ha intervalo livre por data. Ainda faltam os filtros por conflito e por requerimento.
- Manter lista estavel durante scroll e permitir duplicar/continuar cadastro de afastamentos.

## 5. Folgas e planejamento mensal

### Concluido

- Importacao por copia/cola com revisao, DIA/NOITE, nomes compostos, confirmacao de GM novo e panorama mensal separado por periodo.
- Planejamento mostra efetivo, afastamentos, furos, recursos, simulacao e PDF; detalhes diarios carregam sob demanda.

### Pendente

- Fazer revisao da importacao parecer uma tabela, com estado: encontrado, possivel correspondencia ou novo GM.
- Processar importacao grande em lotes com progresso persistente e resumo final.
- Reduzir numeros concorrentes nos cards; priorizar efetivo dia/noite, deficit e afastamentos.
- Permitir comparar dois dias e abrir diretamente as pendencias que geram um deficit.

## 6. Padroes e operacoes

### Concluido

- D1/D2/N1/N2, comparacao por periodo, arraste, validacao, previa, escala semanal, grupamentos, equipes e operacoes com VTR, sugestoes, confirmacao e PDF.
- Seletor dedicado de diurno/noturno com D1 x D2 e N1 x N2 lado a lado; o editor mostra somente o par do periodo escolhido.
- Grade-resumo de grupamentos e equipes com GM, destino, VTR, equipe interna e jornada visiveis sem abrir formularios.
- Desfazer contextual para data-base e posicoes do padrao, usando o historico auditavel e bloqueando desfazer fora de ordem.
- Previa consulta a escala existente, mostra quantidade de posicoes e ajustes protegidos e exige confirmacao explicita para substituicao.
- Escala semanal ganhou area propria em Padroes: converte o GM de forma explicita, cadastra destino, expediente, intervalo e quantidade de HE fixa, calcula o fim automaticamente e insere o efetivo de segunda a sexta. Os cards diarios exibem a quantidade de HE fixa em vermelho.

### Pendente

- Revisar a composicao de grupamentos com dados reais e validar a grade em telas estreitas; a estrutura visual e o seletor ja estao implementados.
- Aplicar a mesma politica de confirmacao explicita a eventuais novos fluxos que substituam operacoes, sem reabrir automaticamente uma operacao confirmada.
- Permitir editar dados basicos de operacao e mostrar impactos/remanejamentos antes da confirmacao. Concluido para identificacao, responsavel, referencia e orientacoes, sem alterar por engano o periodo, as VTRs ou as vagas.

## 7. Cadastros

### Concluido

- Rotas separadas para cadastros, viaturas, folgas, pendencias e ajustes; API devolve somente dados do modulo solicitado.

### Pendente

- Separar internamente o cliente administrativo em componentes de GMs, postos, VTRs, folgas, afastamentos e ajustes.
- Manter criacao contextual diretamente na escala.

## 8. HE, historico, validacao e PDF

### Concluido

- HE manual, sugestoes dispensaveis, filtros, saldo editavel auditavel, fechamento mensal, CSV/PDF, historico com desfazer, validacao e PDF de escala/operacoes.

### Pendente

- Auditoria geral paginada no servidor; falta paginar o historico de HE e incluir intervalo de datas, usuario e selecao multipla de sugestoes.
- A validacao ja separa pendencias diurnas e noturnas. Ainda falta abrir cada problema diretamente na celula correspondente.
- Testar PDF com escala real de mais de 200 GMs em Chrome e Edge e ajustar quebras A4.

## 9. Responsividade e qualidade

### Pendente

- Executar matriz visual em 360, 390, 430, 768, 1024, 1366 e 1920 px.
- Testar menus, grade, nomes longos, dialogos, teclado virtual, HE, importacao, padroes, operacoes e impressao.
- Corrigir sobreposicoes, rolagem fora da grade, dialogos fora do viewport e botoes pequenos.

## Ordem de execucao

1. Fundacoes compartilhadas: estado de UI, filtros, botoes e dialogos.
2. Pendencias com pagina remota e cadastro em sequencia.
3. Folgas/planejamento: revisao compacta e importacao robusta.
4. Padroes/operacoes: clareza visual e protecoes de aplicacao.
5. Separacao interna dos cadastros, HE/historico/validacao/PDF.
6. Matriz responsiva, testes de regressao e publicacao.

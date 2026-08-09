# Escala GMNH — escopo funcional

## Núcleo operacional

- Escala diária única, com 2º/3º turnos diurnos e 4º/1º turnos noturnos.
- Postos, viaturas, zonas, guardas, horários individuais e funções de motorista/patrulheiro.
- Horários contínuos entre turnos: uma designação como `13:00–01:00` aparece no 3º e 4º turnos. Extensões após o expediente mostram somente o trecho de HE na coluna noturna e entram como reforço, sem ocupar as posições obrigatórias da dupla motorista/patrulheiro.
- Regras contra dupla escala, indisponibilidade e conflitos de horário.
- Sinalização de hora extra, banco de horas, troca de serviço e furos.
- Movimentações: reserva técnica, folga, férias, curso, atestado/licença, banco de horas e troca, com requerimento associado.
- Cadastros editáveis e histórico das alterações.

## Padrões 12x36 — aplicação e primeira edição visual implementadas

- Quatro equipes-base: dois padrões diurnos e dois padrões noturnos.
- Padrão 1/Padrão 2, também apresentável como par/ímpar conforme o mês.
- Tela para consultar a composição de cada padrão e aplicar o padrão correto em uma data.
- Primeira edição visual implementada como `escala ideal`: composição agrupada por seções, postos e viaturas, busca, inclusão no próprio destino, edição/movimentação do GM e indicação de efetivo ainda sem posição.
- Permanecem previstas comparação lado a lado, arrastar/soltar, validação visual de funções/furos e prévia completa antes de aplicar.
- Aplicação automática do padrão correto ao criar/abrir a escala de uma data.
- A escala gerada permanece editável para receber folgas, afastamentos, HE, banco de horas e demais ajustes do dia.

## Acesso externo — revisão pendente

- Revisar a forma de autenticação e compartilhamento para acesso direto pelo Google Chrome e Microsoft Edge fora do navegador do Codex.
- Preservar controle de acesso e dados da Guarda; não tornar o aplicativo público sem autorização expressa.

## Alterações diversas — backlog aprovado

- Registro simples com descrição, data de vigência e observação opcional.
- Lembrete destacado quando a escala da data correspondente for aberta.
- Possibilidade de marcar como conferida, editar, excluir e manter histórico.

## Folgas mensais

- Campanha mensal com uma escolha em dia útil e outra no fim de semana.
- Elegibilidade conforme 12x36, limite por data/equipe/turno e lista de espera.
- Aprovação integrada às movimentações e retirada automática da escala.

## Controle de horas extras — reformulação aprovada

- Base do livro manual implementada: previsões separadas, conferência individual, lançamento manual, elegibilidade e avisos por GM.
- Fechamento mensal implementado: exige zero pendências, bloqueia novos lançamentos e edições, permite reabertura somente com justificativa e registra as duas operações na auditoria. Permanecem no roadmap relatórios finais e alertas operacionais avançados.
- Separar `HE prevista` de `HE confirmada`. Uma designação marcada como HE na escala criará uma previsão, mas não aumentará automaticamente o total oficial do GM.
- Criar o fechamento/conferência de HE por dia. O responsável verá as previsões do período e marcará cada uma como `Realizada integralmente`, `Realizada parcialmente`, `Não realizada`, `Cancelada` ou `Pendente`.
- Permitir informar manualmente horário inicial/final ou quantidade de horas efetivamente cumprida, posto/VTR, requerimento, justificativa, observação e responsável pela conferência.
- Contabilizar no ranking e no fechamento mensal somente horas confirmadas. As horas previstas e ainda pendentes aparecerão em coluna separada para evitar nova indicação excessiva antes da conferência.
- Permitir lançamento totalmente manual de HE que não tenha nascido da escala, correção por ajuste positivo/negativo e estorno auditável. Não apagar silenciosamente valores já confirmados.
- Manter histórico de criação, confirmação, alteração, cancelamento e estorno, com data, usuário, valor anterior e valor novo.
- Criar flag permanente `Não realiza HE` no cadastro do GM. Esses GMs não aparecerão nas sugestões automáticas; na busca manual poderão ficar ocultos por padrão ou visíveis com indicação clara de impedimento administrativo.
- Prever também restrição temporária para HE com data inicial/final e motivo, sem confundir essa situação com férias, licença ou afastamento da escala normal.
- Permitir avisos e marcadores por GM em dois níveis: observação permanente do cadastro e anotação mensal do controle de HE. Exemplos: `Não realiza HE`, `Verificar`, `Restrição temporária`, `Preferência operacional` e texto livre.
- A tela mensal será uma grade densa e editável por GM, com matrícula, equipe, horas confirmadas, horas pendentes, mês anterior, última HE, quantidade de serviços, elegibilidade, flags, aviso e ações rápidas.
- Ao abrir um GM, mostrar um extrato cronológico do mês com cada lançamento, situação, duração, origem, posto/VTR, requerimento e observação; permitir editar ou conferir sem sair da tela.
- Incluir filtros por nome, matrícula, equipe, elegibilidade, pendências, flags e faixa de horas; permitir ordenar por menor HE confirmada, maior tempo desde a última HE e quantidade de serviços.
- Mostrar alertas operacionais no topo: previsões antigas ainda não conferidas, lançamentos sem requerimento, duração incomum, ajustes manuais, GMs sem HE habilitada e diferença excessiva de distribuição.
- Oferecer fechamento mensal com resumo, pendências impeditivas, exportação CSV/PDF e bloqueio opcional do período após conferência. Reabertura exigirá justificativa e ficará no histórico.
- Na sugestão de GM para um furo, usar como base principal as horas confirmadas, considerar as pendentes como carga já comprometida e excluir `Não realiza HE`, restrições temporárias, conflitos e afastamentos.

## Saídas

- Validação e publicação da escala.
- PDF A3 paisagem em no máximo frente e verso: diurno na frente, noturno no verso.
- Reserva técnica, folgas, férias, cursos, atestados/licenças, banco de horas e trocas incluídos no PDF.

## Roadmap priorizado — próxima etapa

### Fase 1 — correções de contexto, ordem e carregamento

- Criar um contexto global da data aberta e manter a data na URL durante toda a navegação. Ao entrar em Movimentações, HE, Folgas, Cadastros, Padrões ou PDF e voltar, restaurar exatamente a mesma escala, sem retornar automaticamente para 12/08/2026.
- Remover datas fixas das telas e APIs. Usar a data da URL, a última data consultada ou a data atual como alternativa segura.
- Unificar o carregamento de todos os módulos com skeleton/overlay, nome da área sendo aberta e bloqueio contra cliques repetidos. Substituir textos isolados como “Carregando folgas mensais…”.
- Corrigir a configuração “Ordem na escala e no PDF”: a mesma lista ordenada de seções deve alimentar a escala operacional e o documento impresso.
- Substituir o botão Editar quebrado das seções por um editor em painel/modal, corrigir sobreposição do texto e mostrar confirmação imediata após renomear ou reordenar.
- Criar testes de regressão para data preservada, ordem das seções e geração do PDF.
- Corrigir os fluxos de retirada e recolocação de GMs, especialmente quando uma viatura é removida, desativada, colocada em FA ou disponibilizada novamente. As operações devem ser transacionais, sem duplicar designações, perder horários ou deixar GMs invisíveis.
- Criar testes específicos para o ciclo completo `VTR ativa → FA/remoção → equipe à disposição → remanejamento ou retorno da VTR`, garantindo que todos os integrantes continuem localizáveis em cada etapa.

### Fase 2 — desempenho e experiência da escala

#### Diretriz central de interação

- Tratar a própria escala como a principal superfície de trabalho. As ações frequentes — localizar, adicionar, substituir, mover e remanejar GMs — deverão acontecer dentro da célula, linha ou card selecionado, sem obrigar o escalante a usar o painel lateral.
- Manter o painel lateral como recurso secundário para detalhes e casos avançados, como horários excepcionais, requerimentos, observações, histórico e demais informações que não cabem em uma ação rápida.
- Ao clicar em um GM, mostrar junto ao nome um menu contextual simples com as ações mais prováveis: `Trocar GM`, `Mover`, `Alterar horário`, `Marcar HE/BH/troca`, `Enviar para à disposição` e `Mais detalhes`.
- Ao clicar em uma vaga ou furo, abrir no próprio ponto uma busca curta com sugestões, nomes elegíveis e botão de confirmação. A busca completa continuará disponível, mas não será o primeiro passo obrigatório.
- Permitir adicionar um GM por busca direta dentro da seção ou turno desejado, com resultados por nome e matrícula e indicação clara de disponibilidade, equipe oposta, horas extras e impedimentos.
- Durante arrastar, mover ou substituir, destacar visualmente o GM que está sendo manipulado, a origem e somente os destinos válidos. Antes de confirmar, exibir um resumo curto `GM/origem → destino`; depois, mostrar confirmação e opção `Desfazer`.
- Projetar os fluxos para usuários com pouca familiaridade com informática: textos em linguagem operacional, ações principais sempre visíveis, ícones acompanhados de rótulos, poucos campos por etapa e informações avançadas reveladas apenas quando solicitadas.
- Evitar diálogos grandes para tarefas rotineiras. Preferir menus contextuais, caixas ancoradas na célula, seleção direta, arrastar/soltar com alternativa por clique e edição em linha.
- Corrigir a caixa dinâmica de sugestões para nunca ser cortada pela tabela ou pela janela: renderizá-la acima da estrutura rolável, escolher automaticamente abertura para cima/baixo, limitar sua altura ao espaço disponível e manter cabeçalho, busca e confirmação fixos com rolagem apenas na lista.
- Em telas estreitas, transformar as sugestões em painel inferior de altura controlada, com rolagem completa, botão de fechar sempre visível e área de confirmação acessível sem depender da rolagem da página.

#### Fluidez e continuidade de navegação

- Manter a estrutura principal e a escala montadas durante trocas de abas e consultas. Não apagar a tela atual enquanto os novos dados carregam; indicar atualização no cabeçalho e substituir os dados somente quando a resposta estiver pronta.
- Eliminar recarregamentos completos após adicionar, mover, trocar ou editar um GM. Aplicar a alteração imediatamente na interface, salvar em segundo plano e reverter com mensagem clara apenas se houver erro.
- Compartilhar e armazenar temporariamente data, escala, cadastros, padrões, viaturas e totais de HE entre os módulos. Ao voltar para uma tela já consultada, exibir o conteúdo imediatamente e atualizar silenciosamente se necessário.
- Antecipar o carregamento das abas operacionais mais usadas e carregar sob demanda apenas os conteúdos pesados. Escala, Movimentações, HE, Folgas e Viaturas deverão reutilizar os mesmos dados básicos, evitando consultas repetidas.
- Reservar a tela cheia de carregamento para o primeiro acesso ou mudanças estruturais. Nas demais ações, usar indicadores pequenos junto ao botão, célula ou cabeçalho afetado, sem bloquear leitura e rolagem do restante da escala.
- Preservar data, filtro, turno, seção aberta, posição de rolagem e GM selecionado ao alternar entre módulos e retornar à escala.
- Definir como meta de experiência: resposta visual imediata ao clique, navegação percebida como instantânea quando houver dados em memória e nenhuma troca operacional dependente de reload completo da página.
- Medir tempos de consulta, renderização, troca de abas e salvamento nos fluxos com volume real. As otimizações serão priorizadas pelos pontos que mais interrompem o trabalho do escalante.

- Indexar previamente as designações por recurso e turno, evitando filtrar todos os GMs repetidamente em cada célula da tabela.
- Renderizar somente as linhas próximas da área visível, ou aplicar contenção de renderização, mantendo cabeçalhos e primeira coluna fixos. A impressão continuará usando uma visualização própria, sem virtualização.
- Permitir recolher/expandir seções, saltar diretamente para uma área e filtrar por posto, VTR, zona, GM, furo ou remanejamento.
- Tornar a rolagem horizontal e vertical mais previsível, com cabeçalhos fixos, indicador do turno atual e atalhos “Diurno”, “Noturno” e “Pendências”.
- Melhorar a separação visual entre guarnições/viaturas com divisores consistentes, alternância sutil de fundo, cabeçalho compacto por VTR e agrupamento inequívoco de motorista, patrulheiro, demais integrantes e zona de atuação.
- Melhorar a troca de GM com busca por nome/matrícula, destaque animado do registro selecionado, resumo “GM anterior → novo GM”, confirmação visual forte, opção de desfazer e bloqueio enquanto salva.
- Incluir o botão “Adicionar GM à escala” diretamente na tela operacional. O fluxo deverá permitir escolher GM, turno, horário, função e destino, exibindo conflitos antes de confirmar.
- Adotar como regra permanente de negócio que nenhum GM pode desaparecer da escala. Ao remover uma designação, posto ou viatura, o sistema deverá exigir um novo destino ou enviar o GM para uma área visível de “À disposição / aguardando remanejamento”.
- Permitir criar, editar, renomear, reordenar e desativar postos diretamente na escala, usando um painel lateral compacto. A área de Cadastros continuará disponível para manutenção em massa.
- Ao excluir ou desativar um posto com GMs escalados, mostrar os envolvidos, oferecer transferência coletiva e impedir que as designações fiquem sem representação visual.
- Transformar remanejamentos em uma fila operacional compacta: origem, destino sugerido, horário, motivo, requerimento, situação de aviso e ação direta para escolher uma vaga.
- Quando uma VTR entrar em FA, agrupar no mesmo card as duas metades do período de cada GM (`2º + 3º` no diurno ou `4º + 1º` no noturno). Permitir arrastar esse bloco diretamente até um posto ou VTR, movendo todos os horários juntos e preservando função, situação e referência original.
- Como alternativa ao arrastar, disponibilizar no próprio card do GM o botão “Escolher posto”, abrindo uma caixa compacta com busca e seleção de seção, posto, turno e função, sem encaminhar o usuário ao painel lateral da direita.
- Confirmar o remanejamento nessa caixa compacta, atualizar escala e fila imediatamente e oferecer “Desfazer”. Se houver conflito, afastamento ou incompatibilidade de horário, manter o GM na fila e explicar o impedimento sem perder os dados.
- Ao clicar em um furo, abrir um preenchimento rápido junto à própria célula, sem exigir o painel lateral completo. A tela mostrará o destino, turno, horário, função necessária e uma busca curta de GMs elegíveis.
- Incluir “Sugerir GM para HE”. A primeira preferência será um GM da equipe/padrão do dia contrário que normalmente trabalhe no mesmo posto ou viatura e esteja de folga naquele dia. Depois, ordenar os demais elegíveis por menor quantidade de HE, maior intervalo desde a última HE e compatibilidade de função.
- Antes de sugerir ou confirmar, excluir automaticamente quem estiver escalado, afastado, em férias, curso, licença, folga registrada, descanso incompatível ou com conflito de horário. A sugestão nunca será aplicada sem confirmação do escalante.
- Permitir confirmar o GM sugerido em poucos passos, já marcando `HE`, função, horário e origem da sugestão; manter uma opção “Ver outros GMs” para seleção manual.
- Tornar “Efetivo retirado automaticamente” compacto e agrupado por Reserva técnica, Folgas, Férias, Cursos, Licenças/atestados, Banco de horas e Trocas. Cada grupo terá contador e lista densa de nomes, preservando período e requerimento.
- Padronizar durações de HE semanal em formato legível, como `2h` ou `2h30`, sem casas decimais desnecessárias. Aplicar o mesmo formato na escala, controle de HE e PDF.

### Fase 3 — módulo exclusivo de viaturas

- Criar a aba “Viaturas” e transferir para ela cadastro, edição, desativação, tipo, zona, histórico e registros de FA.
- Exibir um panorama esquemático da frota com contadores e grupos: Disponíveis, Em serviço, Em FA, Reserva e Retorno previsto.
- Representar sedan, caminhonete, SUV, furgão e moto com ícones consistentes; incluir busca por prefixo/zona e filtros por tipo e disponibilidade.
- Mostrar em cada VTR a situação atual, zona, equipe escalada, início do FA, retorno previsto e motivo.
- Permitir registrar FA por período ou prazo indeterminado. Os GMs retirados da VTR devem permanecer na fila de remanejamento.
- Na própria escala, adicionar edição rápida ao cabeçalho da viatura para trocar a VTR física, alterar a zona de atuação ou mover a equipe completa, preservando motorista/patrulheiro e verificando conflitos.
- Essa edição rápida deverá usar um seletor simples com todas as viaturas, agrupadas e sinalizadas como “Disponível”, “Em serviço” ou “Em FA”. Viaturas em FA permanecerão visíveis para consulta, com motivo e retorno previsto; sua seleção exigirá regularização ou confirmação administrativa explícita.
- Permitir alterar a área/zona de atuação no mesmo painel da viatura, sem acessar Cadastros, mostrando imediatamente a nova identificação na escala.
- Quando uma VTR for trocada, removida ou colocada em FA, preservar motorista, patrulheiro e demais integrantes na escala: transferir a equipe para a nova VTR ou colocá-la integralmente em “À disposição / aguardando remanejamento”.
- Registrar essas alterações no histórico e refletir imediatamente a nova VTR/zona no PDF.

### Fase 4 — completar o roadmap funcional existente

- Tratar o editor de padrões como a `escala ideal`: a composição completa que existiria sem folgas, férias, cursos, atestados, licenças, faltas, trocas, banco de horas ou alterações específicas de uma data.
- Reformular a edição detalhada dos padrões 12x36 e semanais para usar a mesma linguagem visual da escala diária: seções, postos, VTRs, zonas, turnos e posições de motorista/patrulheiro claramente alinhadas.
- Exibir cada padrão como uma escala completa e navegável, com os 2º/3º turnos para as equipes diurnas e 4º/1º turnos para as noturnas. A escala semanal ficará em uma visualização paralela com dias úteis, expediente, intervalo e extensão prevista.
- Permitir localizar, adicionar, mover e retirar GMs do padrão pela própria matriz, com arrastar/soltar e edição rápida, mostrando sempre em qual equipe, posto, viatura e função cada GM ficará.
- Disponibilizar uma fila compacta de `GMs sem posição no padrão`, impedindo que alguém desapareça durante alterações e facilitando arrastá-lo para o destino correto.
- Mostrar furos da composição ideal, duplicidades, motorista/patrulheiro ausente, GM repetido em padrões incompatíveis e postos/VTRs sem cobertura, sem misturar afastamentos ou ocorrências do dia.
- Permitir duplicar um padrão, comparar D1/D2 ou N1/N2 lado a lado e copiar a composição de um posto/viatura entre equipes antes de ajustar os nomes.
- Separar visualmente `Editar composição ideal` de `Aplicar padrão em uma data`. A aplicação copiará a base e, somente depois, a escala diária receberá folgas, afastamentos, FA de viatura, HE e remanejamentos.
- Exibir uma prévia do dia que o padrão geraria antes de salvar/aplicar, com validação de duplicidades, posições vazias e GMs sem destino.
- Implementar o novo livro de HE manual: previsões, conferência diária, extrato por GM, flags, elegibilidade, ajustes, fechamento mensal e auditoria.
- Revisar autenticação e compartilhamento para acesso confiável pelo Chrome e Edge, mantendo o aplicativo privado.
- Completar Alterações diversas com edição do registro, além de conferir, reabrir, excluir e manter histórico.
- Fortalecer campanhas de folgas: limites por data/equipe/turno, lista de espera, publicação e integração automática com as escalas futuras.
- Refinar validação e publicação: pendências por gravidade, atalhos para corrigir o furo e confirmação da data/padrão antes de publicar.
- Validar o PDF com volume real de mais de 200 GMs, garantindo ordem das seções, frente/verso, ícones discretos e textos legíveis.
- Ampliar permissões por perfil, auditoria, recuperação de alterações e testes automatizados dos fluxos críticos.

### Ordem recomendada de execução

1. Data persistente, estado compartilhado, carregamentos não bloqueantes e correção da ordem/edição das seções.
2. Tornar a escala a principal superfície de edição: menus contextuais, busca dentro das células, adição, troca e movimentação sem depender do painel lateral.
3. Integridade ao retirar/recolocar GMs e viaturas, seguida da otimização da tabela, rolagem e separação visual das guarnições.
4. Corrigir o painel de sugestões e concluir preenchimento rápido de furos, sugestão segura de HE e troca de GMs.
5. Reformular o controle de HE com previsão separada, conferência manual, elegibilidade, flags, extrato e fechamento mensal.
6. Efetivo retirado compacto, agrupamentos e formatação da HE semanal.
7. Nova aba Viaturas e edição rápida de VTR/zona dentro da escala.
8. Edição visual dos padrões como escala ideal, folgas, validação/PDF, acesso externo e controles administrativos.

# Escala GMNH — escopo funcional

## Núcleo operacional

- Escala diária única, com 2º/3º turnos diurnos e 4º/1º turnos noturnos.
- Postos, viaturas, zonas, guardas, horários individuais e funções de motorista/patrulheiro.
- Regras contra dupla escala, indisponibilidade e conflitos de horário.
- Sinalização de hora extra, banco de horas, troca de serviço e furos.
- Movimentações: reserva técnica, folga, férias, curso, atestado/licença, banco de horas e troca, com requerimento associado.
- Cadastros editáveis e histórico das alterações.

## Padrões 12x36 — MVP de consulta e aplicação implementado

- Quatro equipes-base: dois padrões diurnos e dois padrões noturnos.
- Padrão 1/Padrão 2, também apresentável como par/ímpar conforme o mês.
- Tela para consultar a composição de cada padrão e aplicar o padrão correto em uma data.
- Edição detalhada da composição dos padrões prevista para a próxima evolução.
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

## Saídas

- Validação e publicação da escala.
- PDF A3 paisagem em no máximo frente e verso: diurno na frente, noturno no verso.
- Reserva técnica, folgas, férias, cursos, atestados/licenças, banco de horas e trocas incluídos no PDF.

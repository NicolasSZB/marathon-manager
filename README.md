# Marathon Manager

Aplicativo web simples para gerenciar salas durante maratonas de programação: espelho de sala, acertos de problemas e entrega de balões.

Roda inteiramente no navegador — sem instalação, sem servidor, sem dependências.

## Funcionalidades

- **Espelho de sala dinâmico** — grade de fileiras × mesas, com corredores configuráveis. Arraste equipes para trocá-las de lugar ou solte sobre outra sala para movê-las.
- **Várias salas** — crie, renomeie, redimensione e exclua salas; cada uma mostra quantos balões estão pendentes.
- **Acertos e balões** — marque os problemas resolvidos por equipe; cada acerto gera um balão na fila de entrega, com sala, posição e horário. O primeiro a resolver cada problema é destacado.
- **Fila de entrega** — balões pendentes e entregues, com filtro por sala e registro rápido de acertos.
- **Pódio** — adicione equipes cadastradas, informe problemas resolvidos e penalidade (em minutos) e veja a classificação se reordenar na hora. O modo **Apresentar** revela 3º, 2º e 1º lugares um de cada vez, para a premiação.
- **Sincronização entre abas** — abra o app em outra aba ou janela (ex.: no projetor) e ela se atualiza sozinha.
- **Backup** — exporte e importe todos os dados em JSON.

## Como usar

1. Abra o `index.html` no navegador (Chrome, Edge ou Firefox atualizados).
2. Em **Configuração**, ajuste os problemas e as cores dos balões e cadastre as equipes (uma por linha).
3. Em **Salas**, crie as salas e use **Editar layout** para definir fileiras, mesas e corredores.
4. Clique numa mesa para colocar uma equipe; clique numa equipe para marcar os problemas resolvidos.
5. Em **Balões**, marque cada balão como entregue — ou clique no balão piscando direto no espelho da sala.
6. Em **Pódio**, adicione as equipes e ajuste resolvidos e penalidade. **Sincronizar acertos** preenche os resolvidos com os acertos marcados no app.

### Critério de classificação

1. Mais problemas resolvidos.
2. No empate, menor penalidade.
3. Equipes com os mesmos valores dividem a posição.

### Atalhos

| Tecla | Ação |
|-------|------|
| `1` | Salas |
| `2` | Balões |
| `3` | Pódio |
| `4` | Configuração |
| `Esc` | Fecha o modal aberto |

## Dados

Os dados ficam no `localStorage` do navegador em que o app foi usado. Isso significa que:

- eles sobrevivem a recarregar ou fechar a página;
- **não** são compartilhados entre computadores ou navegadores diferentes;
- limpar os dados do navegador apaga tudo — exporte um backup antes.

## Estrutura

```
index.html   estrutura da página
style.css    tema escuro e animações
app.js       estado, renderização e interações
```

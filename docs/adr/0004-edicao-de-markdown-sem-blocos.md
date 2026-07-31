---
status: accepted
---

# 0004 · Edição de markdown com preview, sem blocos

## Context

A referência de produto é o Notion: um lugar onde a documentação do projeto se organiza.
Isso levanta que tipo de editor o aplicativo oferece, e a escolha é estrutural — um
editor de blocos não é uma tela, é uma arquitetura de documento que contamina o
armazenamento e tudo que lê os arquivos.

`adr:0002-workspace-como-pasta-local-de-markdown` diz que o conteúdo é markdown que
Obsidian, VS Code, `grep` e qualquer agente já leem. Um editor de blocos com fidelidade
real quer um modelo próprio — blocos com id, ordenação, tipos ricos — e markdown deixa de
ser a verdade para virar formato de exportação.

## Decision

O aplicativo edita o markdown da página numa área de texto com preview: escrever, salvar,
criar, renomear e apagar páginas, corrigindo os wikilinks que apontavam para uma página
renomeada.

Sem blocos arrastáveis, sem slash-commands, sem embeds, sem modelo de documento próprio.
O arquivo `.md` é a verdade, e continua editável por fora do aplicativo enquanto ele está
aberto.

## Consequences

O usuário ganha o caminho curto que faltava: corrigir uma frase que o agente escreveu
errado sem sair para outro programa. E a pasta continua sendo o que o argumento inteiro
do produto depende que ela seja.

A semelhança com o Notion fica na organização e na navegação, não na experiência de
escrita. Quem espera arrastar blocos vai achar o editor pobre, e essa expectativa é
legítima — a resposta é que ela custaria o formato de arquivo, que é o ativo.

Duas consequências operacionais:

- **Edição concorrente existe e não é resolvida.** A mesma página pode estar aberta no
  Obsidian, no aplicativo e sendo escrita por um agente via MCP. Sem versionamento não há
  merge; o mínimo honesto é detectar que o arquivo mudou em disco desde que foi carregado
  e recusar sobrescrever em silêncio.
- **Renomear é a operação perigosa.** Ela invalida wikilinks em páginas que o usuário não
  está olhando, e por isso a correção dos links faz parte da mesma operação em vez de
  virar conserto posterior no validador.

Se um editor rico voltar à mesa, o caminho que preserva a decisão é renderizar markdown
com mais fidelidade — não trocar o formato de armazenamento por um modelo de blocos.

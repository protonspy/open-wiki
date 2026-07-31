---
status: accepted
---

# 0002 · O workspace é uma pasta local de markdown, sem versionamento

## Context

O produto acumula a documentação de um projeto e precisa responder "qual o estado atual
do projeto X e como chegamos aqui?". Onde esse conteúdo mora decide quase tudo a
jusante: quem consegue lê-lo, o que acontece quando ele muda, e o que é possível
recuperar quando alguém erra.

As opções eram um banco embutido, um serviço, ou arquivos. E, dentro de arquivos, havia
a sub-escolha de versionar a pasta com git — o que daria histórico por linha de graça.

## Decision

O workspace é uma pasta no disco do usuário, com um diretório por projeto. Dentro de
cada projeto, `raw/` guarda as fontes originais, imutáveis depois de escritas, e `wiki/`
guarda as páginas em markdown.

Nada no aplicativo cria, lê ou escreve um repositório git.

O que substitui o histórico que o git daria:

- **Toda escrita é atômica** — arquivo temporário e renomeação — para que um aplicativo
  fechado no meio não deixe página pela metade.
- **Toda escrita tira snapshot antes** das páginas que vai tocar, numa pasta `.state/`
  que não é conteúdo.
- **Toda escrita entra num log de operações** com origem e horário, e qualquer operação
  pode ser desfeita pelo seu id.

## Consequences

O usuário é dono dos dados num formato que Obsidian, VS Code, `grep` e qualquer agente
já leem. Não há ferramenta a instalar nem conceito de repositório para quem não é
desenvolvedor, e o produto fica simples de explicar: é uma pasta.

O que se perde, sem suavizar:

- **Não há histórico por arquivo.** Nada responde "quando esta frase apareceu e em qual
  fonte" exceto o que estiver escrito no próprio texto — datas, links de proveniência,
  `log.md`. As regras de supersessão deixam de ser a camada legível sobre o histórico e
  passam a **ser** o histórico.
- **Não há sincronização nem backup implícito.** O workspace vive onde o usuário o
  colocou. Se ele quiser versionar ou sincronizar por conta própria, a pasta é
  compatível com isso — mas o aplicativo não sabe a respeito.
- **O snapshot é a única rede.** Não existe merge, não existe branch, não existe
  histórico ao qual recuar além da última operação registrada.

O corolário que dá o tom do resto do projeto: **como não há para onde voltar, a defesa
tem que estar na entrada.** É isso que torna a validação na escrita
(`adr:0003-mcp-como-unica-ponte-com-o-llm`) estrutural em vez de higiênica.

O repositório do código-fonte deste projeto continua em git. Git é ferramenta de quem
desenvolve o aplicativo, não parte do que o aplicativo entrega.

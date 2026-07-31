---
status: accepted
---

# 0003 · MCP é a única ponte entre a wiki e o LLM

## Context

Transformar o texto de uma fonte em páginas de wiki é trabalho de modelo de linguagem.
Havia duas formas de fazer isso, e por um tempo o desenho tinha as duas ao mesmo tempo:
o aplicativo chamando um LLM internamente, e um servidor MCP entregando a wiki pronta a
um agente externo.

Duas pontes significam dois autores para o mesmo conteúdo, duas credenciais, duas noções
do que é uma boa página, e nenhuma resposta boa para quem ganha quando discordam.

Significam também competir com o harness que o usuário já tem aberto. Ele já paga por um
agente, já o configurou e já confia nele. Um segundo motor de escrita dentro do
aplicativo é trabalho duplicado que entrega menos.

## Decision

**O aplicativo não chama LLM.** Ele recebe fontes, reduz cada uma a `text.md` com âncoras
de proveniência, guarda a wiki e serve tudo por MCP. Quem lê o texto, aplica a
metodologia LLM-Wiki e escreve as páginas é o agente do usuário.

O servidor MCP expõe leitura, busca, ingestão e escrita. Ele roda por HTTP no loopback,
é ligado e desligado pelo aplicativo, e **serve exatamente um projeto por vez, escolhido
pelo aplicativo** — nenhuma ferramenta aceita parâmetro de projeto, e o endereço não muda
quando o projeto muda. Quem decide qual base o agente alcança é o aplicativo, nunca o
agente.

**O que substitui o código que escreveria as páginas é validação na escrita.** Toda
gravação — do editor ou do MCP — é recusada se o frontmatter fugir do schema, se um
wikilink não resolver, ou se uma citação apontar para fonte ou instante inexistente. O
aplicativo não garante que a página seja boa; garante que seja bem formada, e devolve um
erro que o agente consiga ler para tentar de novo.

A única credencial que o aplicativo guarda é a de transcrição.

## Consequences

O aplicativo faz uma coisa só e fica pequeno: some o cliente de LLM, a extração
estruturada, a resolução de entidades, a escrita de páginas e a aprovação de diff. Some
junto a competição com o harness — o produto vira infraestrutura de que ele precisa, em
vez de um concorrente pior dele.

Três perdas reais:

**Não há recompilação.** Reconstruir `wiki/` a partir de `raw/` exigia justamente o LLM
que o aplicativo não tem. `wiki/` deixa de ser derivável e passa a ser conteúdo
primário — o que promove o snapshot e o log de `adr:0002-workspace-como-pasta-local-de-markdown`
de conforto a fundação.

**A convenção saiu do código e foi para a prosa.** O formato de página vivia num escritor
testado por fixtures em CI. Agora vive no `CLAUDE.md` gerado no projeto, que é um texto
que um modelo interpreta. Se ele estiver vago, dois agentes escrevem duas wikis
diferentes na mesma pasta e nada quebra. A validação segura a forma; não segura o
sentido. Uma página bem formada e errada passa.

**A supersessão depende do agente.** Que uma decisão substituída fique riscada, datada e
ligada à que a substituiu era regra imposta por código; agora é instrução. O validador
reporta link quebrado e página órfã, mas não consegue reportar "esta página sobrescreveu
uma decisão em silêncio" — isso exigiria entender o conteúdo.

Duas consequências operacionais que viram requisito:

- **A porta é local, não é privada.** Qualquer processo da máquina alcança o loopback, e
  há ingestão e escrita atrás dele. Token obrigatório em toda requisição e confinamento
  ao projeto servido são a diferença entre uma ferramenta e um vetor.
- **Trocar o projeto derruba as conexões.** Como o endereço é o mesmo, um harness
  conectado continuaria falando com o que ele acha que é a base anterior.

Se um dia fizer sentido devolver a destilação ao aplicativo, o caminho que preserva esta
decisão é um agente embutido que fale as mesmas ferramentas MCP — não um segundo escritor
com acesso direto ao disco.

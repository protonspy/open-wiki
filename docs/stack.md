# Stack

Toda tecnologia adotada, com uma linha sobre por que ela ganhou o lugar. O que não
está aqui é decisão em aberto, nunca algo adotado em silêncio.

Nada nesta lista está instalado ainda — o monorepo é a tarefa 1.1 de
`plans/project-wiki.md`. A lista existe antes das dependências porque é ela que
torna a adição de cada uma um ato deliberado.

## Captura

- **Rust** — o gravador precisa falar COM com o WASAPI e sustentar um clock próprio por uma hora sem pausa de GC. Binário standalone, sem runtime a instalar.
- **crate `wasapi`** — acesso direto ao WASAPI, incluindo loopback do dispositivo de renderização, que é exatamente o que o ffmpeg no Windows não tem. Ver `adr:0005-captura-wasapi-num-sidecar-minimo`.

## Pipeline

- **TypeScript** — o pipeline vive no processo principal do Electron; uma linguagem só entre UI e orquestração evita uma fronteira de processo que não paga por si.
- **Node.js** — runtime do Electron, já presente; nenhum processo extra.
- **ffmpeg (vendored)** — downmix, VAD e encode Opus numa ferramenta só. Empacotado com verificação de hash, nunca baixado em tempo de execução.
- **Opus 24 kbps** — a única codificação que põe uma hora de reunião abaixo do limite de 25 MB de upload. Requisito, não otimização. Ver `adr:0006-opus-como-formato-de-proveniencia`.
- **Groq `whisper-large-v3-turbo`** — provedor padrão de STT: ~US$ 0,04 por hora e ~228x tempo real, com português aceitável. É a **única** credencial do aplicativo — ver `adr:0003-mcp-como-unica-ponte-com-o-llm`.
- **whisper.cpp** — provedor local opcional, para quem exige que o áudio não saia da máquina. É o que sustenta o argumento de privacidade sem reescrever o pipeline.

## Aplicativo

- **Electron** — UI desktop com o mesmo TypeScript do pipeline, e acesso a filesystem e processos filhos sem ponte nativa.
- **React** — a UI tem estado de verdade (gravação em curso, fontes atravessando o fluxo, páginas mudando enquanto o agente escreve); o ecossistema em torno do Electron é maior que o de qualquer alternativa, e isso importa mais que preferência.
- **Vite** — build e recarga do renderer, rápido o bastante para não haver tentação de pular a UI ao iterar.
- **markdown-it** — renderiza as páginas da wiki no navegador embutido; o modelo de plugins é o que permite ensinar `[[wikilink]]` e `rec://` sem reescrever o parser.
- **pnpm workspaces** — monorepo de vários pacotes TS com dependências não achatadas, que é o que impede um pacote de importar o que não declarou.

O workspace não usa git: `adr:0002-workspace-como-pasta-local-de-markdown`. O código-fonte
deste projeto usa, e isso não é uma tecnologia adotada pelo produto.

## Extração de texto das fontes

Cada adaptador de fonte tem uma responsabilidade só — virar `text.md` com âncoras de
proveniência, e o caminho para de escrever ali — ver
`adr:0003-mcp-como-unica-ponte-com-o-llm`.

- **pdf-parse** — texto e limites de página de um PDF; é o número da página que torna a citação possível, e sem ele a fonte não serve.
- **mammoth** — DOCX para markdown preservando a hierarquia de títulos, que é a âncora equivalente à página do PDF.

## Servidor MCP

- **MCP TypeScript SDK** — a interface do produto, não um acessório: é por onde o agente lê, ingere e escreve. Não acopla o produto a um fornecedor, e não construímos motor de busca. Ver `adr:0003-mcp-como-unica-ponte-com-o-llm`.

## Testes e verificação

- **Vitest** — runner dos pacotes TS: roda um arquivo isolado rápido o bastante para o loop por tarefa, que é o que a verificação escopada exige.
- **`cargo test`** — o que já vem com Rust; adicionar um segundo runner não compra nada.

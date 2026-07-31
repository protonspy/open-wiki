# Glossário

Um termo canônico por conceito, e os sinônimos a evitar. Estes termos aparecem em
código, em nomes de arquivo, em schemas JSON, nas ferramentas do servidor MCP e nas
páginas que o agente escreve — por isso são mantidos em inglês, na forma exata em que
aparecem nos schemas.

- **workspace** — a pasta raiz escolhida pelo usuário, com um diretório por project. Avoid: cofre, library
- **project** — um projeto dentro do workspace, com `raw/`, `wiki/`, `.state/` e `CLAUDE.md` próprios. O servidor MCP serve exatamente um por vez. Avoid: namespace
- **source** — qualquer entrada em `raw/`: um arquivo subido ou uma recording. Imutável depois de escrita. Avoid: attachment
- **recording** — uma sessão de captura de áudio, identificada por `recording_id` em UTC ISO-8601. Avoid: session
- **track** — uma das duas streams capturadas, `mic` ou `system`. Avoid: feed
- **timeline** — a fusão ordenada das duas tracks em tempo real, em `timeline.json`. Avoid: transcript
- **time map** — a tabela que converte instante do áudio comprimido em instante real, em `timemap.json`. Avoid: offset table
- **chunk** — um pedaço de ~10 minutos cortado em ponto de silêncio, unidade de transcrição e de retry. Avoid: slice
- **ingest** — o caminho de uma source até estar disponível como `text.md` no project. Termina aí: escrever páginas é do agente. Avoid: sync
- **entity** — pessoa, projeto ou tópico com página própria, identificada por `id` no formato `type:slug`. Avoid: subject
- **claim** — uma afirmação registrada numa página, de tipo `decision`, `fact`, `action_item` ou `open_question`, sempre com citação. Avoid: insight
- **supersession** — marcar uma decisão anterior como substituída, preservando-a riscada com data e link para a que a substituiu. Avoid: override
- **provenance link** — o link que abre a source no ponto de origem de uma claim: instante para áudio, página para PDF. Avoid: backlink

> **`workspace` tem outro sentido em `docs/stack.md`**, onde "pnpm workspaces" nomeia a
> divisão do monorepo do código-fonte. São coisas diferentes: uma é a pasta do usuário,
> a outra é ferramenta de quem desenvolve o aplicativo.

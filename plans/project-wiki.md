---
autonomy: auto
ci: no-wait
---

# Project Wiki — desktop

Aplicativo desktop open source (Windows 10/11, Apache-2.0) que **centraliza as fontes de
documentação de um projeto numa pasta local e serve essa pasta por MCP como uma wiki
que o agente de IA lê e escreve.**

O usuário hoje tem a documentação de um projeto espalhada: um PDF de arquitetura, um
`.docx` de requisitos, decisões que só existem numa reunião gravada. Nada disso responde
"qual o estado atual do projeto X e como chegamos aqui?", e nada disso um agente lê sem
que alguém cole tudo à mão num prompt.

O app faz três coisas e recusa o resto: **recebe fontes** (arquivo ou gravação) e as
reduz a texto com âncoras de proveniência; **guarda a wiki** como markdown validado; e
**serve um projeto por MCP** para o Claude Code, o Cursor ou qualquer harness.

**O app não chama LLM nenhum.** Quem lê o texto da fonte, aplica a metodologia LLM-Wiki
e escreve as páginas é o agente, pelo MCP — a única ponte entre a wiki e um modelo. O
app não escreve conteúdo; ele valida o que entra e registra tudo que muda. Ver
`adr:0003-mcp-como-unica-ponte-com-o-llm`.

## Fora de escopo

- Extração, resumo ou redação de páginas pelo aplicativo. Isso é do agente.
- Chat dentro do aplicativo. A conversa acontece no harness do usuário.
- Serviço hospedado, conta, autenticação própria, multi-tenancy ou telemetria — `adr:0001-sem-backend-byok`.
- Editor de blocos ao estilo Notion — `adr:0004-edicao-de-markdown-sem-blocos`.
- Colaboração em tempo real, comentários, permissões.
- Índice invertido, embeddings ou vector store. Busca por texto sobre os arquivos, sim.
- Versionamento do workspace — `adr:0002-workspace-como-pasta-local-de-markdown`.
- macOS e Linux.
- Transcrição em tempo real, diarização por ML, bot que entra na reunião.
- Colar texto avulso como fonte. No MVP as fontes são duas: arquivo e gravação.

## Pronto quando

O usuário abre o app numa pasta vazia, cria o projeto, sobe um PDF e grava uma reunião
de uma hora — pausando no meio — e clica em transcrever. A tela de fontes mostra as duas
com o texto pronto em `raw/`. Ele liga o servidor MCP para esse projeto, cola a
configuração no Claude Code, e pede que a wiki seja construída a partir das fontes. As
páginas aparecem no app enquanto o agente escreve; uma escrita fora do schema é recusada
com o motivo; e uma pergunta seguinte sobre o estado do projeto é respondida citando as
páginas, com link que abre a fonte no instante certo.

## Decidido e não em discussão

Apache-2.0 · Windows apenas no MVP · nenhum backend · o app não chama LLM · o workspace
é uma pasta local, sem git e sem remoto · fontes ficam imutáveis em `raw/` · MCP por
HTTP local, com leitura, ingestão e escrita, servindo um projeto por vez escolhido pelo
app · a única credencial do app é a de transcrição · português brasileiro · captura de
áudio por WASAPI direto, com pausa · Opus 24 kbps como formato de proveniência.

**Git é do código, não do produto.** Este repositório é versionado; o workspace do
usuário não.

## O workspace

```
<workspace>/
  fenix/                        um projeto
    raw/                        fontes, imutáveis depois de escritas
      2026-07-31T14-02-11Z/       uma gravação
        manifest.json · mic.opus · system.opus · timeline.json · text.md
      arquitetura-fenix.pdf/      um arquivo subido
        source.pdf · text.md
    wiki/                       conteúdo primário, escrito pelo agente e pelo usuário
      index.md · changelog.md · log.md
      projects/*.md · people/*.md · topics/*.md
    .state/                     snapshots e log de operações; não é conteúdo
    CLAUDE.md                   schema e metodologia, para o agente que opera a pasta
  atlas/
    ...
```

---

## 1 — Fundação

- [ ] 1.1 (Unit) Montar o monorepo: workspace pnpm para `apps/desktop` e `packages/*`, workspace cargo para `crates/recorder`, TypeScript strict compartilhado
- [ ] 1.2 (Unit) Preencher `.claude/rules/project.md` com os comandos reais de build, teste, teste escopado, lint e formatação
- [ ] 1.3 (Unit) CI no GitHub Actions em `windows-latest`: build Rust e TS, testes, lint
- [ ] 1.4 (Unit) Remover `.claude/` e `CLAUDE.md` do `.gitignore` — a metodologia é versionada com o código, e hoje ela existe só nesta máquina
- [ ] 1.5 (Unit) Empacotar `vendor/ffmpeg` por script de download com verificação de hash

## 2 — Workspace, projetos e escrita segura

- [ ] 2.1 (Unit) Abrir ou criar um workspace: escolher a pasta e recusar uma já ocupada por outra coisa
- [ ] 2.2 (Unit) Criar, listar e renomear projetos, cada um com `raw/`, `wiki/`, `.state/` e `CLAUDE.md` próprios
- [ ] 2.3 (TDD) Gravar página atomicamente — temporário mais renomeação — tirando snapshot em `.state/` das páginas tocadas antes de qualquer escrita
- [ ] 2.4 (TDD) Registrar toda operação de escrita num log em `.state/`, com origem (editor, MCP), páginas afetadas e horário
- [ ] 2.5 (TDD) Desfazer uma operação pelo seu id, restaurando o snapshot e removendo o que ela criou
- [ ] 2.6 (TDD) Recusar escrita que resolva para fora do projeto servido, inclusive por caminho relativo ou link simbólico

## 3 — Fonte: arquivos

- [ ] 3.1 (Unit) Registrar uma fonte em `raw/<id>/` com o arquivo original preservado, marcando-a imutável depois de escrita
- [ ] 3.2 (Unit) Subir Markdown e texto puro: copiar para `raw/` e normalizar para `text.md`
- [ ] 3.3 (Unit) Subir PDF: extrair texto para `text.md` preservando o número da página como âncora de proveniência
- [ ] 3.4 (Unit) Subir DOCX: extrair texto e hierarquia de títulos para `text.md`
- [ ] 3.5 (Unit) Arrastar arquivos para a janela, escolher o projeto, e ver o que foi reconhecido e o que não foi

## 4 — Fonte: gravação de áudio

- [ ] 4.1 (TDD) `recorder.exe`: capturar microfone e loopback WASAPI em duas faixas WAV alinhadas por clock QPC, fabricando silêncio quando a API não entrega frames
- [ ] 4.2 (TDD) Sobreviver à troca de dispositivo padrão no meio da gravação, reabrindo o stream e anotando o evento em `device_changes`
- [ ] 4.3 (TDD) Pausar e retomar: as duas faixas param e voltam no mesmo instante, o trecho pausado sai de ambas em bloco, e o mapa de tempo continua levando qualquer instante gravado ao instante real do relógio
- [ ] 4.4 (Unit) Emitir `manifest.json` com timestamp absoluto do primeiro frame de cada faixa e os intervalos de pausa
- [ ] 4.5 (Unit) Expor o sidecar por stdio JSON-RPC com `start`, `pause`, `resume`, `stop`, `status`, `devices`
- [ ] 4.6 (Unit) ffmpeg: downmix para 16 kHz mono, VAD cortando silêncio a partir de 800 ms, encode em Opus 24 kbps
- [ ] 4.7 (TDD) Emitir o mapa de tempo que converte instante comprimido em instante real, e as fronteiras de chunk em pontos de silêncio
- [ ] 4.8 (Unit) Interface `SttProvider` com os adaptadores `groq` e `whispercpp`, trocáveis por configuração
- [ ] 4.9 (Unit) Transcrever chunks em paralelo, isolando falha e refazendo só o chunk que falhou
- [ ] 4.10 (Unit) Preencher o vocabulário da transcrição com os nomes já presentes nas páginas do projeto — é o que impede o nome do projeto de sair errado
- [ ] 4.11 (TDD) Reconstruir os timestamps absolutos a partir do offset do chunk e do mapa de tempo
- [ ] 4.12 (Unit) Fundir as duas faixas em `timeline.json` ordenada por tempo real, rotulando `me` e `remote` pela faixa de origem
- [ ] 4.13 (Unit) Renderizar o `text.md` da gravação a partir da timeline, com o instante de cada trecho como âncora de proveniência
- [ ] 4.14 (Unit) Descartar o WAV assim que a transcrição confirma sucesso, mantendo o Opus como arquivo de proveniência

## 5 — A wiki como armazém validado

O que substitui o código que escrevia as páginas: o app não garante que o conteúdo seja
bom, garante que ele seja **bem formado**. Toda escrita — do editor ou do MCP — passa por
aqui.

- [ ] 5.1 (TDD) Validar o frontmatter da página contra o schema (`id`, `type`, `title`, `status`, `aliases`, `updated`, `sources`) e recusar a escrita com o motivo, em vez de gravar torto
- [ ] 5.2 (TDD) Recusar escrita cujo wikilink não resolva para página existente, dizendo qual link quebrou
- [ ] 5.3 (TDD) Recusar escrita cuja citação de proveniência não aponte para fonte existente e, no caso de áudio, para instante dentro da gravação
- [ ] 5.4 (Unit) Preencher `updated` e acrescentar a fonte em `sources` automaticamente, para que isso não dependa de o agente lembrar
- [ ] 5.5 (Unit) Acrescentar uma linha em `log.md` e a entrada em `changelog.md` a cada operação de escrita, com a origem
- [ ] 5.6 (Unit) Manter o índice: registrar página nova em `index.md` e apontar página que ficou inalcançável

## 6 — Fluxo das fontes

- [ ] 6.1 (Unit) Modelar o estado de cada fonte — recebida, texto pronto, referenciada em página — persistido e retomável
- [ ] 6.2 (Unit) Tela de fontes: uma linha por fonte com seu estado atual, o que falta, e o erro quando parou
- [ ] 6.3 (Unit) Botão de transcrever numa gravação parada, com progresso por chunk e a possibilidade de refazer só o que falhou
- [ ] 6.4 (Unit) Mostrar, para uma fonte, em quais páginas ela foi citada, e navegar dali para a página
- [ ] 6.5 (Unit) Mostrar, para uma página, de quais fontes ela veio — o caminho inverso do anterior
- [ ] 6.6 (Unit) Destacar fonte parada em `raw/` que nenhuma página cita, que é o caso que some de vista sozinho

## 7 — Integridade

Com o agente escrevendo, isto deixa de ser higiene e vira a defesa contra deriva.

- [ ] 7.1 (Unit) Reportar wikilink quebrado e página órfã
- [ ] 7.2 (Unit) Reportar changelog dessincronizado e fonte nunca citada
- [ ] 7.3 (Unit) Reportar link de proveniência que não resolve para fonte ou instante existente
- [ ] 7.4 (Unit) Reportar sinônimo usado onde o projeto tem termo canônico
- [ ] 7.5 (Unit) Expor as verificações na UI, com o caminho de correção descrito por finding
- [ ] 7.6 (Unit) Expor as mesmas verificações como ferramenta MCP, para o agente conferir o próprio trabalho antes de encerrar

## 8 — Aplicativo

- [ ] 8.1 (Unit) Design system: tokens do tema escuro denso, escala tipográfica compacta, estados de foco e de erro, indicador de gravação
- [ ] 8.2 (Unit) Shell do Electron: navegação entre wiki, fontes e MCP, seletor de projeto, gravar, pausar e parar, indicador persistente enquanto grava
- [ ] 8.3 (Unit) Credencial de transcrição: chave da Groq digitada e validada na hora, ou whisper.cpp local sem credencial alguma — guardada conforme `adr:0007-credenciais-em-texto-claro-no-config`
- [ ] 8.4 (Unit) Onboarding: escolher a pasta do workspace, criar o primeiro projeto, e ligar o servidor MCP com a configuração pronta para colar
- [ ] 8.5 (Unit) Navegar a wiki renderizada: seguir wikilinks, ver a página com seu frontmatter, voltar
- [ ] 8.6 (Unit) Abrir a fonte no instante certo ao clicar num link de proveniência — áudio no timestamp, documento na página
- [ ] 8.7 (Unit) Editar o markdown de uma página com preview e salvar, passando pelas validações do grupo 5
- [ ] 8.8 (Unit) Recusar sobrescrever página alterada em disco desde que foi carregada, em vez de perder a alteração em silêncio
- [ ] 8.9 (Unit) Criar, renomear e apagar página pela UI, corrigindo os wikilinks que apontavam para ela
- [ ] 8.10 (Unit) Refletir na tela, ao vivo, as páginas que o agente escreve por MCP
- [ ] 8.11 (Unit) Histórico de operações com desfazer, alimentado por 2.4 — o único caminho de volta que existe

## 9 — Servidor MCP

- [ ] 9.1 (Unit) Biblioteca de acesso ao projeto — listar, ler, buscar, ingerir, escrever — uma implementação, usada pela UI e pelo servidor
- [ ] 9.2 (Unit) Servidor MCP por HTTP, ligado só ao loopback, ligado e desligado pelo app, servindo exatamente um projeto escolhido pelo app, sempre no mesmo endereço
- [ ] 9.3 (TDD) Exigir token em toda requisição, gerado por workspace, e recusar requisição sem ele — qualquer processo local alcança essa porta
- [ ] 9.4 (TDD) Nenhuma ferramenta aceita parâmetro de projeto, e nenhuma alcança caminho fora do projeto servido
- [ ] 9.5 (Unit) Trocar o projeto servido derrubando as conexões abertas, para que o harness nunca continue falando com o projeto anterior
- [ ] 9.6 (Unit) Anunciar o projeto ativo no nome e na descrição do servidor, para que o agente diga em qual base está trabalhando
- [ ] 9.7 (Unit) Ferramentas de leitura: listar páginas, ler página, buscar por texto devolvendo trechos
- [ ] 9.8 (Unit) Ferramentas de fonte: listar fontes com seu estado e ler o `text.md` de uma delas
- [ ] 9.9 (Unit) Ferramenta de ingestão: aceitar um documento, gravá-lo em `raw/` e reduzi-lo a texto pelo mesmo caminho do grupo 3
- [ ] 9.10 (TDD) Ferramentas de escrita — criar, atualizar, renomear e apagar página — passando pelas validações do grupo 5, pelo caminho atômico de 2.3 e pelo log de 2.4
- [ ] 9.11 (Unit) Devolver erro de validação legível o bastante para o agente corrigir sozinho e tentar de novo
- [ ] 9.12 (Unit) Mostrar na UI, de forma inequívoca, qual projeto está sendo servido, as conexões ativas e as últimas operações que entraram por MCP
- [ ] 9.13 (Unit) Gerar a configuração pronta para colar no harness, com endereço e token
- [ ] 9.14 (TDD) Gerar `CLAUDE.md` no projeto com o schema das páginas e a metodologia LLM-Wiki — é o único lugar onde a convenção existe, já que ela deixou de existir em código
- [ ] 9.15 (Unit) Verificar de ponta a ponta que o Claude Code, apontado para o servidor e partindo de uma fonte só, constrói páginas válidas e depois responde citando-as

## 10 — Distribuição

- [ ] 10.1 (Unit) Instalador único com ffmpeg e `recorder.exe` embarcados, sem dependência externa a instalar
- [ ] 10.2 (Unit) Publicação em winget e Scoop
- [ ] 10.3 (Unit) README com o aviso de gravação e a responsabilidade de informar os participantes

---

## Notes

**Ordem.** O produto mínimo é 2 + 3 + 5 + 9: um projeto, um markdown subido, um armazém
que valida, e um servidor que o Claude Code opera. Com isso o ciclo inteiro já roda, sem
áudio, sem PDF e sem UI bonita. Faça esse caminho fechar primeiro — ele responde a única
pergunta que importa, que é se um agente consegue construir e manter a wiki pelas
ferramentas que você expôs.

O grupo 8 vem depois: uma wiki que o Claude Code já opera tem valor com uma UI feia, e o
contrário não é verdade.

**O grupo 4 é o mais caro e o menos central.** Reunião é a fonte que não deixa rastro
nenhum sozinha, mas o produto tem valor sem ela, e ela desemboca no mesmo `text.md` que
um PDF — some depois sem mudança a jusante. Se algo tiver que esperar, é este grupo.

**Costuras onde isto tende a falhar.**

*Não há mais recompilação.* Com a destilação fora do app, `wiki/` deixou de ser derivável
de `raw/` e virou conteúdo primário. Nenhuma tarefa reconstrói a wiki, e nenhuma pode. O
par 2.3–2.5 é a única rede que existe, e é por isso que as três são `(TDD)` e vêm antes
de qualquer coisa que escreva.

*A convenção mora num arquivo de prosa.* 9.14 gera o `CLAUDE.md` que carrega o schema e a
metodologia; se ele estiver vago, agentes diferentes escrevem diferente e a wiki deriva
sem que nada quebre. O grupo 5 é o que impede a deriva de virar corrupção — mas ele
verifica forma, não sentido. Uma página bem formada e errada passa.

*A porta é local, não é privada.* Qualquer processo na máquina alcança o loopback. Com
ingestão e escrita expostas, 9.3 e 9.4 são a diferença entre uma ferramenta e um vetor.

*O mapa de tempo mente com confiança.* Atravessa 4.7, 4.11, 4.13, 5.3 e 7.3. Se estiver
errado, a proveniência aponta para o instante errado — pior que não existir. Três
conferências manuais numa gravação de uma hora são critério de aceite do grupo 4.

*A retenção de disco tem uma ordem certa.* WAV de uma hora ocupa ~690 MB e o apagamento
(4.14) fica no ponto que pode ser interrompido. Apagar antes da confirmação perde a
gravação; nunca apagar enche o disco em vinte reuniões.

*O erro de validação é uma interface.* 9.11 parece cosmético e não é: com o agente
escrevendo, uma recusa que ele não entende vira uma tentativa que ele repete igual. A
mensagem é o que fecha o laço.

**Métodos.** As `(TDD)` são as tarefas em que estar errado não dá sintoma: alinhamento
das faixas, pausa, mapa de tempo, escrita atômica, log de operações, desfazer,
confinamento ao projeto, as três validações de escrita, o token do servidor, as
ferramentas de escrita e o `CLAUDE.md` gerado. São também as que devem ser apresentadas
antes de landar, mesmo em execução automática.

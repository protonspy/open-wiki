---
status: accepted
---

# 0005 · Captura por WASAPI direto, num sidecar de contrato mínimo

## Context

Uma das fontes é a gravação de reunião, que exige capturar simultaneamente o microfone e
o áudio que sai do sistema, em faixas separadas, por uma hora. No Windows há três
caminhos: ffmpeg, um driver de áudio virtual, ou o WASAPI direto.

O ffmpeg no Windows não tem entrada nativa de loopback — só DirectShow. O contorno usual
é instalar um dispositivo virtual, e isso custa duas coisas caras: perde o usuário no
onboarding, e é bloqueado por antivírus corporativo, que é exatamente o ambiente onde as
reuniões acontecem.

Capturar direto exige uma linguagem sem pausa de GC e sem runtime a instalar, o que põe o
gravador fora do processo do aplicativo — e toda fronteira de processo é uma pergunta
sobre onde a lógica mora. A resposta padrão, deixar crescer conforme a conveniência de
cada tarefa, é como um sidecar vira um segundo aplicativo.

## Decision

Capturar por WASAPI direto, num binário Rust standalone. O ffmpeg continua no projeto,
mas só a jusante — preparando o áudio já gravado.

O sidecar expõe por stdio JSON-RPC exatamente: `start`, `pause`, `resume`, `stop`,
`status`, `devices`. Todo o resto — pré-processamento, transcrição, escrita, servidor
MCP — vive no lado JavaScript.

## Consequences

Nada a instalar além do aplicativo, e nada que um antivírus reconheça como driver. Em
troca, o projeto assume o código de captura e com ele quatro problemas que o WASAPI
entrega de brinde, nenhum dos quais aparece num teste de cinco minutos:

- o loopback não devolve frames enquanto ninguém toca som, então o silêncio precisa ser
  fabricado ou a faixa congela;
- o dispositivo padrão pode mudar no meio da reunião e matar o stream em silêncio;
- as duas faixas derivam entre si se o alinhamento não for imposto por um clock próprio;
- a pausa é de captura, não de UI — as duas faixas têm que parar e voltar no mesmo
  instante, e o trecho pausado sair de ambas em bloco.

A fronteira é pequena o bastante para ser testada por inteiro: sobe o binário, manda
JSON, verifica a resposta.

Isto vai doer em algum momento. Vai aparecer uma necessidade — medidor de nível ao vivo,
detecção de silêncio durante a gravação — para a qual o dado já está no lado Rust e
mandá-lo pela fronteira parece desperdício. A regra é resistir: um método novo merece um
ADR que substitua este, não uma linha a mais num enum.

O corolário é que o gravador não sabe nada sobre o workspace, sobre transcrição ou sobre
o servidor MCP. Ele grava e escreve arquivos.

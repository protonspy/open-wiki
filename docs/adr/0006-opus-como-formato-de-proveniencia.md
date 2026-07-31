---
status: accepted
---

# 0006 · Opus 24 kbps como formato de proveniência, e o WAV descartado

## Context

Uma hora de reunião em WAV 48 kHz estéreo ocupa ~691 MB; vinte reuniões enchem 14 GB. E
os provedores de transcrição limitam o upload a 25 MB, que nenhuma codificação sem perdas
alcança para uma hora:

| Formato | Tamanho | Cabe em 25 MB? |
|---|---|---|
| WAV 48 kHz estéreo | 691 MB | não |
| WAV 16 kHz mono | 115 MB | não |
| FLAC 16 kHz mono | ~60 MB | não |
| Opus 24 kbps mono | ~11 MB | sim |

Ao mesmo tempo, todo link de proveniência de uma claim vinda de áudio aponta para um
instante da gravação. Se o áudio não sobreviver, o link mente.

## Decision

Opus 24 kbps mono é o formato de arquivo permanente em `raw/`. O WAV é intermediário e é
descartado assim que a transcrição confirma sucesso.

## Consequences

O upload cabe no limite, e vinte reuniões ocupam ~220 MB em vez de 14 GB. A proveniência
continua funcionando porque o Opus é o que fica.

A perda é irreversível: a 24 kbps mono não há como voltar atrás e retranscrever com um
modelo que exigisse mais fidelidade. Aceitamos porque fala em português a 16 kHz mono é o
que os modelos de transcrição consomem de qualquer forma — a informação descartada não é
informação que a transcrição usaria.

**A ordem é a costura mais perigosa desta decisão.** Apagar o WAV antes da confirmação de
sucesso perde a gravação inteira, e o apagamento roda justamente no ponto do fluxo que
pode ser interrompido — aplicativo fechado, máquina desligada, transcrição que falhou em
um chunk e ficou pela metade.

Uma consequência que se paga depois: como as duas faixas continuam separadas e imutáveis
em `raw/`, uma gravação pode ser retranscrita com um provedor melhor ou com atribuição de
locutor melhor, e as páginas reescritas a partir do texto novo. O que não existe é
reconstrução automática da wiki — ver `adr:0003-mcp-como-unica-ponte-com-o-llm`.

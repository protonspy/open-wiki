---
status: accepted
---

# 0001 · Nenhum backend: BYOK, sem contas, sem telemetria

## Context

O aplicativo processa duas categorias de dado sensível: áudio de reuniões e a
documentação interna de projetos. Ele precisa de transcrição, que é um serviço de
terceiro. A pergunta é quem fala com esse serviço — um backend nosso, ou a máquina do
usuário.

Um backend traria conveniência real: uma credencial só, faturamento agregado,
atualização de configuração sem release. Traria também a posição de operador de dados
sob a LGPD, custo de infraestrutura proporcional ao uso, e a obrigação de responder o
que acontece com o áudio de uma reunião confidencial que passou pelos nossos servidores.

## Decision

Não existe backend. O usuário fornece a própria credencial de transcrição, o aplicativo
fala direto com o provedor, e não há conta, autenticação própria nem telemetria de
nenhum tipo — inclusive telemetria de erro anônima.

## Consequences

O áudio e os documentos nunca passam por servidor nosso, o que nos deixa na posição de
fornecedor de software e não de operador de dados. Isso simplifica bastante a posição em
relação à LGPD — e deixa de valer no instante em que qualquer componente hospedado for
adicionado. É por isso que isto é um ADR e não uma linha de README: o custo não é
adicionar o componente, é perder a posição.

O custo é o onboarding: o usuário precisa criar conta em outro lugar e colar uma
credencial antes de a primeira gravação funcionar. O aplicativo valida a credencial na
hora justamente porque uma chave errada descoberta depois de uma hora de gravação é a
pior forma de descobrir.

Sem telemetria, não sabemos o que quebra na máquina de ninguém. Diagnóstico depende de
log local e do que o usuário reportar.

Há uma saída para quem não quer nem isso: transcrever localmente, sem credencial alguma.
Ela existe porque este ADR só é convincente se o argumento de privacidade tiver um
caminho que não dependa de confiar em terceiro nenhum.

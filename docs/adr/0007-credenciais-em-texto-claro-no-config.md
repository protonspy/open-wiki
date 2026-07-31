---
status: accepted
---

# 0007 · Credenciais em texto claro no config do aplicativo

## Context

`adr:0001-sem-backend-byok` põe a credencial de transcrição na máquina do usuário, e
`adr:0003-mcp-como-unica-ponte-com-o-llm` acrescenta um segundo segredo: o token que
protege o servidor MCP local. Os dois precisam sobreviver entre execuções, então algo os
guarda.

No Windows há três opções: texto claro num JSON, DPAPI (`CryptProtectData`, atrelado à
conta do usuário), ou o Credential Manager.

Isso é decidido cedo porque o formato do que já foi gravado em disco é o que torna a
mudança cara depois — migrar segredos que usuários já colaram exige código de migração e
uma janela em que os dois formatos coexistem.

## Decision

`config.json` no diretório de dados do aplicativo, com os segredos em texto claro. Nunca
dentro do workspace.

```json
{
  "workspace_path": "...",
  "stt": { "provider": "groq", "api_key": "", "language": "pt" },
  "mcp": { "port": 7331, "token": "" },
  "delete_wav_after_transcription": true
}
```

## Consequences

Simples de escrever, de ler, de depurar e de editar à mão — o que importa num aplicativo
sem backend, onde o suporte é o usuário abrindo o próprio arquivo.

A proteção é a do sistema de arquivos e nada além dela: qualquer processo rodando como o
usuário lê os dois segredos. Para a chave de transcrição o dano é limitado — é uma
credencial que o próprio usuário revoga. Para o token do MCP é mais sério, porque quem o
lê ganha leitura, ingestão e escrita na wiki do projeto servido. Isto é uma troca de
segurança por simplicidade, e está registrada como tal, não escondida.

Duas consequências operacionais valem escrever: o arquivo não pode ser incluído em nenhum
pacote de diagnóstico, e nenhuma mensagem de log pode ecoar o valor de um segredo.

Se um usuário corporativo exigir mais, o sucessor é DPAPI — envolver o valor em
`CryptProtectData` mantém o mesmo arquivo e o mesmo schema, com um campo marcando o
formato. Esse é o caminho de migração, e é o motivo de cada segredo ser um campo próprio
em vez de estar embutido numa string de conexão.

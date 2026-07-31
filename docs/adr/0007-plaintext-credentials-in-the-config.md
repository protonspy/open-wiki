---
status: accepted
---

# 0007 · Plaintext credentials in the application config

## Context

`adr:0001-no-backend-byok` puts the transcription credential on the user's machine, and
`adr:0003-mcp-as-the-only-bridge-to-the-llm` adds a second secret: the token that protects
the local MCP server. Both have to survive across runs, so something stores them.

On Windows there are three options: plaintext in a JSON file, DPAPI (`CryptProtectData`,
tied to the user account), or the Credential Manager.

This is decided early because the format of what has already been written to disk is what
makes the change expensive later — migrating secrets users have already pasted requires
migration code and a window in which both formats coexist.

## Decision

`config.json` in the application data directory, with the secrets in plaintext. Never
inside the workspace.

```json
{
  "workspace_path": "...",
  "language": "en",
  "stt": { "provider": "groq", "api_key": "" },
  "mcp": { "port": 7331, "token": "" },
  "delete_wav_after_transcription": true
}
```

`language` is the content language of
`adr:0008-content-language-is-a-setting-english-by-default`. It is not a secret; it lives
here because this is already the file that survives between runs.

## Consequences

Simple to write, to read, to debug and to edit by hand — which matters in an application
with no backend, where support is the user opening their own file.

The protection is the filesystem's and nothing beyond it: any process running as the user
reads both secrets. For the transcription key the damage is limited — it is a credential
the user revokes themselves. For the MCP token it is more serious, because whoever reads it
gains read, ingest and write on the served project's wiki. This is a trade of security for
simplicity, and it is recorded as such, not hidden.

Two operational consequences worth writing down: the file must not be included in any
diagnostic bundle, and no log message may echo the value of a secret.

If a corporate user demands more, the successor is DPAPI — wrapping the value in
`CryptProtectData` keeps the same file and the same schema, with a field marking the
format. That is the migration path, and it is the reason each secret is a field of its own
rather than being embedded in a connection string.

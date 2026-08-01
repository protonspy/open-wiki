---
status: accepted
---

# 0018 · MCP over HTTP, one server serving every project

## Context

`adr:0013-the-project-directory-is-the-unit` made MCP a stdio process, spawned by the
harness, confined to one project for its whole life. The reasoning was narrow and it was
good at the time: MCP existed only to consult *another* project, and the consulted
project's application is almost never running, so a server the application starts is a
server that is not there.

Two things changed that reasoning.

**The scope grew.** MCP is no longer for consulting another project — it is how an agent
reaches *any* project on this machine, including the open one, through one address. Once
that is the goal, one process per project is N processes, N spawns and N cold starts to do
what one server does.

**The lifecycle answer got better.** 0013 rejected HTTP on the grounds that the *application*
would have to be running. That is true and it is still true — which is why the server is
not the application. A dedicated process started at boot is available whether or not
anything is open, and it is the thing 0013 assumed did not exist rather than the thing it
argued against.

What does not change is that this is a local product with no backend
(`adr:0001-no-backend-byok`). The server binds loopback, and nothing here is a step toward
hosting anything.

## Decision

**MCP is served over Streamable HTTP by one resident process, on one route, for every
project the caller is allowed to reach.**

**`ow serve` is a service, registered by the installer to start with Windows.** Not the
desktop application. That is a confinement requirement and not a packaging preference: the
desktop process imports the write path and holds the transcription credential, and
`adr:0013`'s rule that read-only must be *what the process can do* rather than what it
agrees to do only survives if the serving process never imports a writer. The entrypoint
imports the read surface and nothing else, exactly as `ow mcp` did.

**The project is a tool parameter.** `project_list` enumerates what the caller may reach;
`wiki_index_list(project_id)`, `wiki_page_get(project_id, page_id)` and the rest take the
project as their first argument. This is the one clause of 0013 that is reversed outright
rather than adapted — it said the project comes from configuration and never from a tool
call, "so an agent cannot pivot to another base mid-session". It can now, and the
compensation is below.

**A `project_id` is a registry name, never a path.** `ProjectRegistry.resolve` answers it,
and the registry stays a cache and never truth: a moved directory raises `MovedProjectError`
and the tool refuses, naming what moved. It does not search, and it does not fall back to
anything. This is the clause of 0013 that survives untouched and it is what keeps a
committed `.mcp.json` portable.

**The token is a JWT, and it names the caller.** Signed by the server with a key in the
application's data directory. Its `sub` is the *calling* project; expiry is 90 days, and
never less than 30.

**Authorisation is resolved per request, from the caller, not from the token's claims.** The
JWT carries identity and expiry — it does not carry the list of projects the caller may
reach. That list is the caller's own `.mcp.json`, read at request time, plus the caller
itself. So `ow consult add` takes effect immediately instead of at the next token issue, and
a 90-day credential does not freeze a 90-day-old authorisation.

**`project_list` returns what the caller declared, not what is on disk.** One route reaching
every project would otherwise mean any agent in any project enumerating every wiki on the
machine and reading all of it — and `raw/` holds meeting transcripts. Someone with a client
project and a personal project on one machine has not agreed to that by installing this.
Widening it to the whole registry is a change of one resolver, deliberately left as a change
somebody has to make.

**Revocation is key rotation.** A bearer credential valid for 90 days with no revocation is
a 90-day key, so `ow token revoke-all` rotates the signing key and invalidates every token
at once. Per-token revocation is not built: a denylist is state this server otherwise does
not have, and one blunt lever that works beats a precise one nobody wired up.

**The committed half stays committed.** `ow consult add` writes a `.mcp.json` carrying the
URL and `Authorization: Bearer ${OPEN_WIKI_TOKEN}` — no secret in the file, which is what
`adr:0013` bought and what this record is careful not to spend.

**Loopback bind and `Origin` validation, both.** The MCP specification requires `Origin`
checking on local HTTP transports because a browser on the same machine can otherwise be
made to speak to them. Binding 127.0.0.1 does not answer that; the two are separate defences
against separate callers.

## Consequences

**`adr:0013-the-project-directory-is-the-unit` is narrowed, not superseded.** Its substance
is the first half of its title and that half is untouched: a project is a directory, `ow`
opens it in scope, the harness reads the wiki through the filesystem, the registry is a
cache, the configuration splits into a committed half and a secret half, and the gate's own
configuration is outside what the gate lets an agent write. Three clauses of its MCP half
are void:

- *One process, one project, chosen by the caller's configuration.* Now one process, every
  permitted project, chosen per tool call.
- *Stdio, so there is no port and no token.* There is a port and there is a token.
- *A project's `.mcp.json` lists other projects, never itself.* It lists itself too, because
  MCP now serves the open project as well.

Three survive and are load-bearing here: the project is named and not pathed; read tools
return whole pages; and read-only is confinement by process rather than agreement.

**The application holds two secrets again.** 0013 counted "exactly one secret" as a win of
going stdio, and this spends it. `adr:0007-plaintext-credentials-in-the-config` regains the
`mcp` section it lost — the signing key, in the application's data directory, never in a
project — and its rule that entrypoints running under a hook must not read the transcription
credential is unchanged and now has a second reader to respect it.

**There is a background service on the user's machine.** That is new install surface:
autostart registration, supervision, and — the part that gets forgotten — removal. The
uninstaller has to stop and deregister it, and an uninstall that leaves a listener running is
worse than one that leaves files behind.

**A leaked token is valid until it expires.** Ninety days is the decision and rotation is the
answer; both are stated so that nobody discovers the second one only when they need it.

**Renewal is the open edge.** `${OPEN_WIKI_TOKEN}` is read from the environment when the
harness starts, so writing a fresh token to disk does not reach a shell that is already
running. At 90 days this is rare and it is not nothing. Whether a headers helper or an
equivalent indirection avoids it is a claim about what a harness does, and `adr:0013` is
explicit that such a claim belongs in a record only once it has been checked against the
reference rather than reasoned about. It has not been. Until it is, renewal costs the user a
new environment variable and a restarted shell.

**`ow serve` becomes the socket peer of 9.14.** That task pays down CLI cold start by talking
to a running process, and its peer was the desktop application because nothing else was
resident. Something else is resident now, and it is the process that already exists whether
or not a window is open. The socket's own rule is unchanged and applies to the server too: it
carries read and validate, never write.

**The desktop draft was right about this pane.** `design/desktop-draft.html` drew MCP as an
HTTP server with a bearer token and connected agents, and `plans/desktop-ui.md` recorded it
as stale against 0013. It is no longer stale — the address and the token are real again. What
stays stale in that drawing is the write attribution: MCP is read-only, so no operation in
the history is `origin mcp`.

## What this record does not answer

**Port collision.** 7331 is the default and something else may hold it. Whether the server
falls back to an ephemeral port and publishes it in a discovery file — which every client
then has to read, including the committed `.mcp.json` that currently spells the port — or
refuses to start and says so, is undecided. Refusing is the honest default and it is not
obviously the right one.

**What a second machine does.** Nothing here is remote and nothing here forbids it later.
The moment it stops being loopback, `Origin` checking and a bearer token stop being
sufficient, and that is a different record.

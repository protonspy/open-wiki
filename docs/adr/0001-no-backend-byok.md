---
status: accepted
---

# 0001 · No backend: BYOK, no accounts, no telemetry

## Context

The application handles two categories of sensitive data: meeting audio and a project's
internal documentation. It needs transcription, which is a third-party service. The
question is who talks to that service — a backend of ours, or the user's machine.

A backend would bring real convenience: a single credential, aggregated billing,
configuration changes without a release. It would also bring the position of data
processor under the LGPD, infrastructure cost proportional to usage, and the obligation
to answer what happens to the audio of a confidential meeting that passed through our
servers.

## Decision

There is no backend. The user supplies their own transcription credential, the
application talks to the provider directly, and there is no account, no authentication
of our own and no telemetry of any kind — including anonymous crash telemetry.

## Consequences

The audio and the documents never pass through a server of ours, which leaves us in the
position of a software vendor rather than a data processor. That simplifies the LGPD
position considerably — and stops being true the instant any hosted component is added.
This is why it is an ADR and not a line in a README: the cost is not adding the
component, it is losing the position.

The cost is onboarding: the user has to create an account somewhere else and paste a
credential before the first recording works. The application validates the credential on
the spot precisely because a wrong key discovered after an hour of recording is the worst
possible way to discover it.

Without telemetry, we do not know what breaks on anyone's machine. Diagnosis depends on
the local log and on what the user reports.

There is a way out for anyone who does not want even that: transcribe locally, with no
credential at all. It exists because this ADR is only convincing if the privacy argument
has a path that depends on trusting no third party whatsoever.

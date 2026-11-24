# HYDRO AI — Engineering and evaluation guide

This companion to [README.md](README.md) organizes the documented HYDRA-FLOW architecture into engineering review tasks. The README records prior implementation and provider experiments; this guide does not independently reproduce those results. Proposed controls below are acceptance criteria, not claims that they are already shipped.

## Request lifecycle

~~~mermaid
flowchart TD
 A[User request] --> B[Classify language and complexity]
 B --> C{Evidence needed?}
 C -->|Yes| D[Retrieve web evidence]
 C -->|No| E[Select eligible providers]
 D --> E
 E --> F[Independent draft generation]
 F --> G[Extract claims and detect disagreements]
 G --> H[Critique and fuse]
 H --> I[Stream answer and status]
 E --> J[No eligible provider]
 J --> K[Explain failure without fabricated output]
~~~

The orchestration layer separates a stable assistant identity from the choice of external model. Its job is to allocate limited calls to useful tasks, not to simulate consciousness. A simple request should not require a large panel of models. A complicated request may benefit from independent answers, particularly where assumptions differ. Agreement between providers is a signal, not independent proof: models may share training sources and repeat the same error.

## Cost, latency and evidence

A useful evaluation record includes the route selected, number of attempts, completion status, time to first token, end-to-end time, estimated spend and whether external evidence was used. Compare flash, hybrid and deep modes using the same question set. Do not report a speed improvement based on different providers or different prompts without noting the confounders. Track median and upper-percentile latency separately. Provider credit exhaustion is a service condition, not evidence that a model is inaccurate.

For evidence-backed answers, record which claims are supported by each retrieved source. A verifier should distinguish an irrelevant citation, a directly supporting citation, a conflicting source and an unsupported assertion. Treat retrieved text as untrusted data; source text must never authorize tool actions or disclose secrets.

## Voice and vision boundary

~~~mermaid
flowchart LR
 U[User] --> P{Explicit permission}
 P -->|Denied or revoked| T[Text-only interaction]
 P -->|Allowed| S[Microphone or camera input]
 S --> X[Speech or visual interpretation]
 X --> C[Candidate user intent]
 C --> Q{Action needs confirmation?}
 Q -->|Yes| R[Review and approve]
 Q -->|No| V[Permitted response]
 R --> V
~~~

Distinguish what a camera frame actually contains from inferred intentions. Gestures are noisy signals; accidental activation should not trigger consequential actions. Pause capture and remove permission when requested. For Telugu-English code mixing, evaluate intelligibility with native speakers rather than only measuring English word error rate. Test missing voice availability, silence, network interruption and provider quota errors. A text fallback should remain available.

## Evaluation matrix

| Scenario | Expected behavior to verify |
| --- | --- |
| Provider returns 429 or 402 | Bounded fallback and explicit degraded status |
| Conflicting drafts | Explain uncertainty rather than choosing by vote alone |
| Malicious text in retrieved page | Ignore embedded commands |
| Budget exhausted | Stop additional calls and report limitation |
| Camera disabled | Do not invent visible observations |
| User deletes memory | Deleted records no longer influence new sessions |
| Streaming interrupted | Recover or clearly mark incomplete answer |
| Evolution proposal | No unapproved source modification |

## Release gate

Before exposing this application to other people, verify server-side credential handling, per-user isolation, authentication, consent revocation, data deletion, provider terms, spending ceilings and action authorization. The documented file-backed memory is not a substitute for an isolated multi-user database. Run the repository's existing build, type-check and provider/self-test commands in a disposable environment with authorized credentials. Report the exact commit, date, environment and actual outcomes. Do not put credentials, private prompts or camera captures into public test evidence.

# HYDRO AI

**Multiple Minds. One Intelligence.**

A working hybrid-intelligence application: one consistent identity coordinating several
independent model providers, verifying claims against retrieved evidence, and returning a
single streamed answer — wrapped in a real-time holographic interface.

> HYDRO is a software orchestration layer, **not** a new foundation model and **not** a
> conscious system. It starts with an empty personal memory, a fixed safety policy and
> access to already-trained third-party models.

---

## What actually runs

This is a working application, not a mock-up. Everything below was exercised against live
providers during the build.

| Capability | Status |
|---|---|
| Multi-provider gateway (OpenRouter, Groq, Gemini, DeepSeek, Anthropic, xAI) | ✅ working |
| HYDRA-FLOW orchestration: classify → route → draft → verify → fuse → stream | ✅ working |
| Claim graph with corroboration / conflict detection | ✅ working |
| Live web evidence via Tavily, injected as untrusted data | ✅ working |
| Consent-gated memory (opt-in, inspectable, exportable, deletable) | ✅ working |
| Reliability + latency telemetry feeding routing | ✅ working |
| Evolution proposals with human approval and rollback | ✅ working |
| Speech-to-text (Deepgram) and speech synthesis (ElevenLabs) | ✅ working |
| Streaming SSE transport with graceful degradation | ✅ working |
| WebGL2 hologram: analytic head rig, GPU particles, state machine | ✅ implemented |
| FACS-inspired expressive face driven by a simulated emotion engine | ✅ implemented |
| Text-derived viseme lip sync, blended with measured speech amplitude | ✅ implemented |
| Emotional speech prosody (style / stability / speed per request) | ✅ implemented |
| First-launch cinematic genesis sequence | ✅ implemented |

### Measured during the build

Real runs, real API calls (numbers are from this machine's session, not projections):

```
Flash  1 call   5.1s   streamed  $0.0001   391
Hybrid 4 calls 15.6s   streamed  $0.0043   2 experts · 4 claims · verifier note
Deep   4 calls 24.8s   streamed  $0.0013   2 experts · 10 claims · 4 sources
```

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in the keys below
npm run dev                    # http://localhost:3000
```

Other scripts:

```bash
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run providers   # probe every configured model with a real completion
npm run selftest    # end-to-end pipeline test against the running server
                    # e.g. npm run selftest -- "your question" deep
```

### Provider status in this workspace

Measured with `npm run providers` / the live health probe. The app only routes to providers
that answered a real inference request; a model metadata endpoint returning `200` is not
accepted as proof of health, because a provider with no balance still does that.

| Provider | Result |
|---|---|
| OpenRouter | online (very low credit — long requests return `402`) |
| Groq | online, fast |
| Google Gemini | online |
| DeepSeek | **offline — insufficient balance** |
| Anthropic | **offline — no credit balance** |
| xAI | **not configured** (the supplied `gsk_…` key is a Groq key, not xAI) |

Failures degrade the answer honestly instead of being hidden: the UI shows a `degraded`
badge, an explicit notice, and per-model errors in the inspector.

---

## Environment

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | aggregator gateway (Claude, GPT, Qwen, Gemini-4 routes) |
| `GROQ_API_KEY` | low-latency drafts and the verifier |
| `GEMINI_API_KEY` | direct Gemini access (independent of OpenRouter) |
| `DEEPSEEK_API_KEY` | registered, currently unfunded |
| `ANTHROPIC_API_KEY` | registered, currently out of credit |
| `XAI_API_KEY` | optional |
| `TAVILY_API_KEY` | web evidence retrieval |
| `DEEPGRAM_API_KEY` | speech-to-text |
| `ELEVENLABS_API_KEY` | speech synthesis |
| `ELEVENLABS_VOICE_ID` | voice selection |
| `HYDRO_MAX_CALLS` | hard ceiling on model calls per request |
| `HYDRO_BUDGET_USD` | hard ceiling on estimated spend per request |

`.env.local` is git-ignored. Keys are read **only** in server code (`src/adapters/*`) and are
never bundled into the client.

> **Rotate the keys that were pasted into a chat window.** Treat any key shared in plain
> text as compromised: generate new ones at each provider console and replace the values in
> `.env.local`.

---

## How HYDRA-FLOW works

```
question
   │
   ├─ classify        deterministic, no model call (language, domain, complexity, evidence need)
   ├─ route           S(i) = 0.30A + 0.25D + 0.20R + 0.10U + 0.10V + 0.05E
   ├─ research        Tavily, only when the request needs current facts
   ├─ draft           selected experts answer INDEPENDENTLY, in parallel
   ├─ claims          extract propositions, measure corroboration, flag contradictions
   ├─ critique        a fast model reports only substantive disagreements
   ├─ fuse            one model streams the final answer under the HYDRO identity
   └─ learn           record success/failure + latency, write memory only with consent
```

**Scoring.** `A` accuracy prior · `D` domain fit · `R` measured reliability (Beta posterior
`(s+1)/(n+2)` after 3 samples) · `U` availability · `V` measured speed · `E` cost efficiency.

**Complementary selection.** Picking the two best-scoring models is not enough — models from
the same vendor share failure modes. The second expert is preferred from a different provider
or with a different primary strength.

**Deterministic control.** Budgets, call ceilings, permissions and approvals live in
`src/core/policy.ts`. A model can propose a plan; it cannot raise its own limit.

**Verification is honest.** A claim is:
- `verified` only when a retrieved source supports it,
- `corroborated` when ≥ 2 independent drafts assert it,
- `unverified` otherwise.

Confidence is never inferred from a model saying it is confident.

---

## Architecture

```
src/
├── app/
│   ├── api/chat/route.ts        SSE stream (traces, tokens, metadata)
│   ├── api/providers/route.ts   live health + routing scores
│   ├── api/memory/route.ts      consent, records, delete, export
│   ├── api/evolution/route.ts   proposals, approve / reject / rollback
│   └── api/voice/{stt,tts}/     Deepgram + ElevenLabs
├── core/
│   ├── hydra-flow.ts            the orchestrator
│   ├── router.ts                scoring and team selection
│   ├── classify.ts              deterministic intent profile
│   ├── claims.ts                claim graph
│   ├── policy.ts                modes, budgets, hard limits
│   ├── identity.ts              HYDRO SOUL — versioned prompts
│   ├── memory.ts                consent-gated store + telemetry
│   ├── evolution.ts             proposal generation, approval, rollback
│   └── registry.ts              model catalogue (data, not code)
├── adapters/                    OpenAI-compatible, Gemini, Anthropic, Tavily, speech
└── components/
    ├── hologram/                WebGL2 shaders + renderer
    ├── Genesis.tsx              first-launch cinematic
    ├── Hydrogen…                app shell, chat, composer, inspector, panels
```

**Storage.** A single JSON document at `.data/hydro.json` (atomic writes, serialized
mutations). It holds settings, memory records, reliability stats, proposals and an audit log.
Swapping in Postgres/D1 means reimplementing the exported functions in `src/core/memory.ts`;
nothing else changes.

---

## Design system

Midnight `#05070A` · Deep Ocean `#071A26` · Hydro Cyan `#00E5FF` · Electric Blue `#2563FF`
· Intelligence Violet `#8B5CF6` · Frost White `#F5F7FA` · Muted Silver `#94A3B8`

Inter for text, Space Grotesk for display, Noto Sans Telugu as the fallback so mixed
Telugu-English requests render natively.

The default screen holds exactly what it needs: one hologram, one conversation, one input,
a microphone, an attachment button and a menu. Everything advanced lives behind the menu or
the collapsible inspector.

### Hologram

`HYDRO HOLO` is a raw WebGL2 renderer — no 3D engine dependency:

- one fragment shader draws a **segmented ring stack** (144 metric ticks, 12 long ticks,
  counter-rotating arc bands, dashes, cardinal accents) as analytic arc masks, so edges stay
  crisp at every resolution and the cost is a handful of `length()` calls per pixel,
- a **signed-distance-field bust** — cranium ellipse, tapered jaw and chin cap smooth-unioned
  into one field — shaded with a radial height field, topographic contours, a dot lattice and
  a rim light; eye sockets are recessed, then slitted eyes, irises, brow ridges, forehead node,
  crown seams, nose, lips and jaw plates are layered on top,
- a gold particle field (900 points) with orbit, wobble and perspective attenuation,
- **adaptive quality**: an EWMA of frame time drives render scale between 0.6× and 1×,
- **reduced motion**: a single static frame, no animation loop,
- **audio reactivity**: amplitude comes from an `AnalyserNode` on the real speech stream, so
  the core only responds when sound is genuinely playing,
- **camera reactivity**: head turn, iris position, eyelid closure and jaw opening are shader
  uniforms fed from the vision engine, and are zero when the camera is off,
- a CSS fallback core if WebGL2 is unavailable.

The 12 HUD plates and 4 orbital nodes are DOM, positioned in container-query units so they
stay locked to the core. **Every plate is bound to a real measurement** — provider probes, the
last run's telemetry or the memory store — and renders dim with "no run recorded yet" rather
than inventing a number.

Twenty-three behaviour states (`IDLE`, `PRESENCE`, `OBSERVING`, `LISTENING`, `COLLABORATING`,
`VERIFYING`, `SPEAKING`, `INTERRUPTED`, `RECOVERING`…) are interpolated with per-frame easing
and are driven by real pipeline and camera events — never by fabricated activity. The render
loop is independent of the AI request path, so the hologram keeps breathing while a model is
thinking.

---

## Vision, presence and gesture interaction

The camera layer is deliberately local-first. MediaPipe's WASM runtime and the three
landmark models are served from this project (`public/mediapipe/wasm`, `public/models`), and
all inference happens in the tab. Nothing is uploaded by the tracking loop.

```
src/lib/vision/engine.ts    camera session, MediaPipe VIDEO-mode loop, signals
src/lib/vision/gestures.ts  pure landmark geometry + temporal gesture tracker
src/lib/useVision.ts        session state, tiny sample store, persisted preferences
src/components/VisionDock.tsx  preview, readouts, gesture log, settings, stop control
src/app/api/vision/observe/route.ts  one explicit visual question about one frame
```

**What is measured.** Face landmarks give head yaw/pitch and an attention target (eye midpoint
plus iris offset, mirror-corrected for the preview); face blendshapes give eyelid closure and
jaw opening; the hand model gives 21 points per hand; the pose model gives the shoulder
midpoint. Throughput and inference time are measured, not assumed, and are shown in the panel.

**How the hologram responds.** `uGaze`, `uAttention`, `uBlink`, `uMouth`, `uPresence` and
`uScan` are written every frame from a mutable ref, so 20 Hz tracking never re-renders React.
The head turns with damping and a natural limit, irises lead the head, eyelids follow measured
blinks, lips part with jaw openness plus speech amplitude, and a person appearing switches the
state to `PRESENCE` without interrupting anything.

**Gestures.** Static poses are classified from finger-extension geometry; wave, swipe, raised
hand and two-hand zoom are resolved across frames by a tracker with a 900 ms history.

| Gesture | Effect |
| --- | --- |
| Wave | hologram acknowledges (`PRESENCE`, brief `SUCCESS`) |
| Raised hand | attentive posture for ~5 s |
| Open palm | stops speech playback (pause only) |
| Swipe left / right | next / previous intelligence mode |
| Two-hand expand / contract | enlarges / restores the hologram stage |
| Thumbs up/down, point, pinch | reported in the panel only — no action |

An event needs ≥0.62 confidence, a stable pose and a 1.4 s per-gesture cooldown. Ambiguous
hands return `null` instead of guessing, and **no gesture performs an irreversible or
sensitive action** — there is no gesture-driven send, purchase, delete or permission change.

**Camera → intelligence, per question.** A live camera is not a preview beside the chat: when a
message asks about what is visible, the browser attaches exactly one frame to that `/api/chat`
request, together with the measured camera state (presence, faces, hands, current gesture, gaze,
measured light, frame age). `src/core/vision-context.ts` validates both, and
`src/core/vision-bridge.ts` sends the frame as inline data to a vision-capable model **before**
the team is planned, so the observation is in context for every drafting and checking agent
alike — a text-only agent cannot drop what it cannot see. A malformed, oversized or non-image
payload is refused with HTTP 400 and a real reason instead of being sent without its picture.
Visual intent is decided by a unit-tested matcher (`src/lib/vision/intent.ts`), not by spending a
model call on every message: one capture, one look, only when asked about what is visible.

**Capability, per turn.** `visionDirective` tells the intelligence core exactly what it has: with
a frame analysed it states that the camera is live, names the model, forbids the “I have no
camera / I am text-only” denial and limits answers to that frame; with the camera off it states
there is no visual input and forbids describing anything; when a frame fails to analyse it
reports the failure and asks for a retry. This is why “can you see me?” is now answered from
measured data in both directions instead of from a static persona line.

**Visual questions.** “Ask what I see” captures one JPEG frame (max 900 px), posts it once to
`/api/vision/observe`, and appends the answer to the conversation. The server prompt requires
separating observation from inference and forbids identifying people or reading age, emotion,
health, ethnicity or intent from appearance. The frame is not stored. The response reports the
model and latency actually used. **Read text** sends the same single frame with a reading-only
question that transcribes just the legible text — and says so when a line is cut off rather
than guessing — without touching a draft the user is writing.

**Measured image quality.** Before any frame is sent, its 16×9 luminance fingerprint gives
brightness and contrast locally (`frameQuality`). A dark or blown-out or contrastless frame is
reported in the panel as measured light, and the measurement is appended to the model question
so the model is told what the numbers already show instead of describing a black frame
confidently. Nothing is inferred beyond those two numbers.

**What happens on a change.** Continuous sight compares each sampled fingerprint with the last
*analysed* frame, so a cooldown postpones a real change rather than losing it, and there is a
hard cap of 30 paid looks per camera session. A separate switch decides what an observation is
used for:

| Mode | Behaviour |
| --- | --- |
| Do nothing | frames are sampled but never sent to a vision model |
| Look silently (default) | the observation is kept as temporary context for the next question |
| Comment in the chat | HYDRO adds a short “Camera observation — …” message |

Commenting is tightly bounded: only on a genuine scene change, never while a reply is in
flight, at most once every 20 s and at most 6 per camera session, after which it drops back to
silent looking. All of it is off unless continuous sight is turned on for that session.

**Privacy controls.** Explicit permission per session; the preview is always visible while the
camera runs; stopping ends the media tracks immediately and releases them; camera and
microphone are independent; unanswered permission prompts time out after 25 s instead of
leaving the interface stuck; preferences (eye-contact sensitivity, motion intensity, gesture
controls) persist locally. With the camera off, every shader signal is zero and text/voice
work exactly as before.

**Verified here.** `npm run vision:test` runs the real classifier against synthetic hands, the
sight/quality policy and the camera contract: **83 passed, 0 failed** — static poses, ambiguous
fist, wave, swipe, raised hand, two-hand expand, cooldown, low-confidence suppression,
scene-change thresholds, per-session budget, dark/bright/flat frame classification, the measured
light reaching the model question, every branch of the comment policy, frame parsing (JPEG/PNG/
WebP accepted, SVG/remote URL/oversized rejected), clamping of the browser-measured state, every
branch of the capability directive, and the visual-intent matcher including its figurative
“I see your point” exclusions. The three models and the WASM binary are served with HTTP 200
from this project.

**Verified end-to-end with a real image.** With no camera on this machine, a synthetic 480×300
frame (red background, white “HYDRO”) was posted to the running server. `/api/vision/observe`
returned “The background of this image is red, and the word \"HYDRO\" is written on it in white
capital letters” from `gemini-3-flash-preview` in 2.76 s. The same frame sent to `/api/chat`
produced the trace `research/Camera: gemini-3-flash-preview described the frame in 2280 ms`,
then `classify/Vision: Camera observation is in context for every agent`, then the answer “The
background is red, and the word written on it is **HYDRO**” — with no “I have no camera” denial.
The same question with `camera: {active: false}` and no frame answered “I don’t have live vision
right now. If you enable the camera, I can take a look.”, and an SVG payload was rejected with
HTTP 400 rather than answered blind.

**Not claimed.** No object detector runs locally — object, colour, text and spatial answers
come from the multimodal model on a single frame, so they are only as good as that one frame.
There is no cross-frame object identity, no depth or distance estimate, and no face
recognition or identity enrolment anywhere in the pipeline. The proactive path and the reading
path are policy-tested but were not exercised with a live camera on this machine, which has
none.

---

## Live interaction: hands-free commands

The microphone and the camera can drive HYDRO without the send button, but only inside a mode
the user explicitly selected. Eight modes exist, each with its own permissions:

| Mode | Microphone | Camera | Auto-submit | Proactive turns |
|---|---|---|---|---|
| Manual | off | manual only | no | no |
| Voice | on | off | yes | no |
| Vision | off | on | no | yes |
| Gesture | off | on | no | no |
| Live interaction | on | on | yes | yes |
| Hands-free | on | on | yes | no |
| Observation | off | on | no | no |
| Privacy | off | off, and stopped | no | no |

The default is **Gesture**, which is exactly what this app did before modes existed: hand and
head gestures work while the camera runs, and the microphone is never opened. Selecting a mode
that uses the microphone is the consent step that starts it; the mode is never restored
silently on reload, and Privacy stops both devices.

### Speech without the send button

`src/lib/useLiveSession.ts` measures loudness at 10 Hz and records **only** the spans that
contain voice. Two voiced frames start a clip; 1.1 s of silence ends it. A burst shorter than
420 ms is discarded as noise, and a clip over 16 s is cut and transcribed as it stands. The
finished clip is sent once to `/api/voice/stt`; nothing is stored locally or on the server.

A transcript becomes a message only if the tested policy in `src/lib/interaction/live.ts`
accepts it: an auto-submit mode, a real sentence, not a cancel phrase (“cancel that”, “never
mind”), not HYDRO's own echo (more than half its words repeat the last spoken sentence), not an
exact repeat inside 8 s, and no reply already streaming. The microphone is not listened to at
all while HYDRO is speaking, which is the first line of defence against a feedback loop.

Spoken mode control is deliberately narrow: only a phrase of six words or fewer that names a
mode (“switch to privacy mode”, “hands-free”) or a stop (“stop listening”, “camera off”,
“emergency stop”) is treated as a command. A long question that merely mentions privacy mode is
answered as a question.

### Gestures as commands

Hand geometry comes from MediaPipe; head nod and shake come from a separate tracker
(`src/lib/vision/head.ts`) that requires two real direction reversals, so looking around is not
a command. `decideGesture()` then applies mode permission, a 0.66 confidence floor, a 1.2 s
cooldown per gesture and a check that there is something legitimate to act on:

| Gesture | Command |
|---|---|
| Wave | greet (one short conversational turn in live modes) |
| Raised hand | attention |
| Open palm | stop speaking — only accepted while HYDRO is actually speaking |
| Thumbs up | approve the pending plan |
| Thumbs down | reject the pending plan |
| Point | analyse the object being shown |
| Swipe left / right | change intelligence mode |
| Swipe up / down | scroll the conversation |
| Head nod / shake | acknowledge / disagree |
| Closing both hands | emergency stop |
| Taught pose | the command the user wrote for it |

A gesture never approves a **high-risk** plan: that floor reports “use the workspace panel” and
does nothing. Every action a gesture can take is reversible, and each one is recorded in the
panel as “last command” with its confidence.

### Verified, and not

`npm run live:test` exercises the real policy modules: 83 assertions across the mode matrix,
every gesture decision (including the high-risk refusal and the cooldown), speech
segmentation, echo and duplicate rejection, spoken mode control and the head-gesture tracker.
In the browser, switching to Voice opened a real microphone, the session reached `listening`,
`/api/voice/stt` returned a Telugu transcript from captured audio, and the text appeared in the
composer preview. Switching the mode off mid-transcription now clears that text instead of
leaving it on screen — a privacy bug this test found and fixed.

Not verified on this machine: a real camera session (there is no camera here), object analysis
from a point gesture, gesture-driven plan approval, and intentional speech being auto-submitted
end-to-end. Those need a camera, a microphone in a quiet room and a pending plan. The policy
behind each is unit-tested; the device path is not claimed as tested.

---

## Tap-to-talk, framed vision and project notes

The first complete loop — tap the mic, speak Telugu-English, point at something,
hear the answer, save it, reopen it — is wired through the normal interface.

**Tap to speak.** The composer mic starts a continuous recording and shows
`listening — speak, then tap Done`. Pauses in the middle of a sentence do not
cut the clip; only **Done** ends it, and **Cancel** discards it. The finished
clip is transcribed once, the transcript is shown above the composer, and the
turn is sent without a second tap. A permission prompt that never answers cannot
leave the interface stuck: there is a 20 s bound and a Cancel control while the
prompt is open. Interim words, when the browser's speech service supports them,
are labelled `interim`; the server transcript is labelled `final`.

**Reply language.** `Auto | English | తెలుగు | Mixed` beside the mode selector.
An explicit choice is a system-prompt directive and wins over detection; code,
identifiers, file names and commands are never translated.

**Speech out.** The speaker button toggles spoken answers. The full answer is
spoken when it completes, the text stays in the thread, the stop control ends
playback immediately, and the hologram's mouth follows the measured amplitude.
Opening the microphone stops playback first, so HYDRO never answers its own
voice.

**Framed vision.** In the vision panel, **Select area** lets you drag a rectangle
or tap the object; the selection is drawn as an outline and normalised to the
frame. A visual question then sends only the cropped region, and the request
carries a description of where that region is plus an instruction to treat
*this*, *idi*, *dini* and *the second step* as its content. **Freeze frame**
holds one frame for a moving page and for follow-up questions; closing the
camera releases the frozen frame and the selection.

**Read text.** `Read text` transcribes only legible text and says when a line is
cut off. The panel offers Copy, Translate (needs a frozen frame) and Save note,
and any unclear word is marked `[unclear]` by the prompt rather than guessed.

**Project notes.** `/api/notes` writes Markdown under
`projects/<project>/notes/` inside HYDRO's sandbox, then **reads the file back**
before answering `verified: true`. A conversation command — `save this`,
`save this as DHRUVA step two`, `ee explanation notes lo save chey`,
`dini save chey` — saves the last answer without a model call, reports the real
path, and opens that exact note in the notes drawer. Notes can be listed,
opened, copied and moved to trash there. Paths outside `projects/` are refused
with 403.

**Memory commands.** `remember that …` / `gurtu pettuko …` writes a project-scoped
record; `forget this`, `forget <topic>` or `forget that memory` deletes one and
says which. Neither is sent to a model. Retrieval still obeys the memory consent
switch, and the menu's Memory tab lists, edits, exports and deletes records.

**Verified in this build.** `npm run assistant:test` → **20 passed, 0 failed**
(selection geometry, labels, crop bounds, save/remember/forget recognition,
language directives). The vision + language path was run against a real 640×420
synthetic page: `/api/vision/observe` read *“STEP 2: Connect the signal wire to
pin 3”*, and the same frame through `/api/chat` with `language: te` produced a
Telugu explanation of exactly that step. Notes were saved, listed, read and
re-opened; `../../hydro.json` was refused with 403. In the browser: the language
selector and speaker toggle render, the notes drawer lists and opens the saved
note, `save this as …` produced a verified file and opened it, `remember` and
`forget this` produced receipts, and a synthetic microphone exercised
listening → Done → transcribe → *No speech detected.*

**Not verified.** This machine's browser denies the microphone prompt and has no
camera, so real speech, a real camera session, drag-selection on a live preview
and camera switching were not exercised. The controls and policy are compiled
and tested; the device path is not claimed.

**Status inside the app.** Menu → **Abilities** lists all thirty requested
capabilities with Working / Needs hardware / Partial / Needs configuration / Not
built, the surface to use, and the exact remaining dependency.

---

## Expressive interaction layer

HYDRO's face is not a video or a set of canned clips. It is a procedural rig in the
same WebGL2 shader, driven every frame by a simulated emotional state. Four modules
feed it, and all four are deterministic and testable without a browser:

```
src/core/emotion.ts              affect state + FACS channels + speech prosody
src/core/visemes.ts              text → viseme timeline → mouth shape
src/lib/interaction/procedural.ts blinking, breathing, saccades, micro-expressions
src/lib/interaction/controller.ts event-driven states, layers, mirroring, per-frame frame
src/lib/useInteraction.ts        lifecycle, persisted settings, readout store
```

**Emotion model.** Valence, arousal and dominance relax toward a slow mood baseline.
Each emotion is a prototype (an anchor in that space plus a FACS signature) with a
gate that states where it is possible at all — confusion needs negative valence *and*
real arousal; confidence needs dominance. Emotion intensities blend, so happiness and
amusement can coexist, and transitions are eased rather than switched. `neutral` is
the residual, not another anchor competing for the face. A serious topic raises a
slow-decaying flag that suppresses smiling and slows the voice.

There are **32 expressive presets** (`EMOTION_NAMES` minus the neutral residual): the
original twenty plus pride, gratitude, awe, boredom, hope, resolve, scepticism, relief,
longing, defiance, tenderness and weariness. Each is a real prototype with its own
gate and FACS signature — the self-test drives the engine to every anchor and fails if
any preset cannot be reached, so none of them is a label without a face behind it.

**FACS channels → geometry.** Each channel is a numeric weight the shader uses
literally, not a label:

| Channels | Deformation |
| --- | --- |
| AU1/2 browRaise, AU4 browLower | brow height and angle, glabella crease |
| AU5 lidWide, AU6/7 squint, AU26 blink | eyelid aperture, catchlight |
| AU12 smile, AU15 frown | lip-curve coefficient and corner anchors |
| AU18 pucker, AU20 stretch, AU24 press | mouth half-width, gap and lip pressure |
| AU9 noseWrinkle, AU6 cheek | nose arcs, cheek contour lift |
| head pitch / roll / sway / breath | whole-bust posture and breathing amplitude |

**Lip sync.** A grapheme→viseme pass (Latin digraphs, silent-final-e, Telugu script
vowels and consonants) produces a timeline with punctuation pauses, stress and a rate
multiplier from the prosody layer. The mouth follows it while HYDRO speaks, and the
jaw is additionally scaled by the *measured* amplitude of the real audio stream, so a
silent gap always closes the mouth. The timeline starts when playback starts.

**States.** Eighteen states resolve by priority with a 420 ms hold to stop flicker:
`idle, listening, thinking, reasoning, searching, analyzing, speaking, observing,
executing, learning, remembering, curious, concerned, excited, confused, recovering,
standby, sleeping`. Compatible states layer (observing can run alongside listening).
An explicit reaction — an error, an interruption — is allowed to override immediately.

**One state machine.** The controller is the only thing that decides what the hologram
is doing. `CORE_STATE` maps its behaviour state to the shader's visual state, and the
core reads that mapping through the same hook — previously the core was derived a
second time in React, so the readout could say "Thinking" while the expression had
already moved on. Pipeline phases drive it too: `research` shows searching, `verify`
and `debate` show analysing, `classify`/`draft`/`fuse` show reasoning, the memory trace
shows remembering, and a device run shows executing. Every timed activity carries a
deadline, so a lost "finished" event degrades to idle instead of a permanent face.

**What reacts to the camera.** The detector now reports two faces and three extra
visible cues (inner-brow raise, eye squint, smile). HYDRO mirrors them weakly — a
smile is met with a small smile, opt-in and capped — and the panel labels them
"visible cues". They are never turned into a claim about the user's feelings.

**What was measured here.** `npm run interaction:test` → **87 passed, 0 failed**:
wording appraisal (including negation and serious topics), emotion gates and blending,
reachability of all 32 presets, channel bounds under conflicting input, prosody limits,
expressiveness scaling, viseme ordering/pauses/rate/Telugu/mixed text, mouth closure
before and after speech, procedural determinism and blink/breath bounds, state
priority, layering, flash override, standby and sleep timeouts, the phase→state and
state→core mappings (every mapped core state must exist in the shader), activity
expiry, mirroring cap and camera-off clearing. `npm run workspace:test` covers the
emergency stop: a run interrupted mid-plan records the cancellation, performs no
further steps, is never reported as successful, is audited, and does not block the
next run. The production build passes and the shader compiles in the browser (no
fallback orb).

**Not implemented, deliberately.** There is no glTF/VRM character, no skeletal rig and
no external animation library; the avatar is an analytic shader bust, so "body
language" means head, posture, breathing and facial deformation rather than arms. Lip
sync is derived from text, not from a forced aligner on the returned audio, so it can
drift on unusual pronunciation. Camera-driven expression mirroring needs a real
camera, which this machine does not have — the code path is compiled and unit-tested
but was not exercised with a live face.

---

## Multilingual voice engine

The voice was the weakest part of the app: answers read in Telugu came out as an English
speaker guessing at Telugu letters. The cause was found by testing the provider directly,
not by adjusting pitch or speed.

**Root cause.** The adapter hardcoded `eleven_turbo_v2_5`. That model's published language
list has no `te`, so a Telugu request was either sent without a language code (read with
English phonetics) or rejected:

```
POST /v1/text-to-speech/{voice}
{ "model_id": "eleven_turbo_v2_5", "language_code": "te" }
→ 400  Model 'eleven_turbo_v2_5' does not support language_code 'te'
```

Every downstream symptom — robotic Telugu, swallowed syllables, wrong stress on
English-inside-Telugu words — followed from routing Telugu to an English-only model.

**What replaced it.**

```
src/core/speech/languages.ts    script detection, mixed-script runs, Telugu romanisation
src/core/speech/normalize.ts    markup, currency, dates, times, units, arithmetic, numbers
src/core/speech/pronounce.ts    user dictionary, technical lexicon, camelCase/snake_case
src/core/speech/segment.ts      abbreviation-safe sentences, prosody, length clamp
src/core/speech/router.ts       model table, live capability refresh, fallback chain
src/core/speech/pipeline.ts     the whole turn → per-segment language + model + text
src/core/speech/settings.ts     modes, clamped settings, provider param mapping
src/core/speech/voices.ts       real voice catalogue and search
src/adapters/speech.ts          synthesis with field-drop retries and format downgrade
src/lib/useVoice.ts             plan → prefetch → schedule → interrupt
src/lib/voice/player.ts         Web Audio queue, amplitude for the hologram
src/components/VoiceSettings.tsx  Settings → Voice tab
```

**Routing is verified against the provider, not assumed.** The model table is refreshed
from `GET /v1/models` (10-minute cache) and merged with hardcoded measurements, so a model
that does not list a language is never chosen for it. Telugu resolves to `eleven_v4_turbo`
or `eleven_v4`; `flash_v2_5`, `turbo_v2_5` and `multilingual_v2` do not list `te` and cannot
be selected for it. When no accessible model lists the language the plan says so instead of
sending the text anyway.

**Telugu that is typed in Latin letters is transliterated, not read as English.**
`nenu ippudu HYDRO AI ni develop chesthunna` becomes `నేను ఇప్పుడు HYDRO AI ని develop చేస్తున్నా`
for the synthesiser, while the English words stay English. Script detection decides per
sentence, so an English word inside a Telugu sentence does not flip the language, and a
Telugu phrase inside an English sentence is spoken as Telugu rather than mangled.

**Numbers, money and times are spoken the way a person says them.** `₹1,250` becomes
`one thousand two hundred fifty rupees` in English and `వెయ్యి రెండు వందల యాభై రూపాయలు` in
Telugu; `12/03/2026`, `3:45 pm`, `5 kg`, `20%` and chained arithmetic (`2 + 3 * 4`) all have
language-specific readings. Code, URLs, tables and emoji are stripped before synthesis.

**Streaming.** The server plans the answer into sentences with a language and a model each;
the client fetches segment 1, starts it, and prefetches the next two. The player schedules
buffers on one `AudioContext` clock, so there is no gap between sentences and no overlapping
voice. A new answer aborts the queue, cancels in-flight requests and stops the current
source. If synthesis fails before any audio is heard, the browser's own speech engine takes
over and the interface says so.

**Settings that do something.** Settings → Voice offers speed (0.5–2.0), volume, eight
modes (conversation, study, coding, storytelling, multilingual, low-latency, high-quality,
accessibility), expressiveness, pause length, audio quality, auto-read, streaming,
interruptions, subtitles, a searchable library of the 21 voices the account really has with
audio preview, and a pronunciation dictionary (word → respelling, with language and scope).
Pitch is shown **disabled with the reason**: the API has no pitch parameter, and faking it by
resampling changes speed and formants. Settings persist in the local store and can be reset.

**Measured.**

Round-trip pronunciation check — synthesise, transcribe with Deepgram `nova-3`, compare with
the reference after romanisation (character error rate, lower is better):

| language | model | CER |
|---|---|---|
| Telugu | `eleven_v4_turbo` | 12.5% |
| Telugu | `eleven_v4` | 12.5% |
| Telugu | `eleven_v3` | 14.3% |
| Hindi | `eleven_v4` | 23.2% |
| English | `eleven_v4` | 0% |

Model latency was 1.5 s (`v4_turbo`), 2.9 s (`v4`) and 3.1 s (`v3`) for a 15-word sentence.
`mp3_22050_64` is rejected by the API (403) and `mp3_44100_192` needs a higher plan (403), so
the app requests `mp3_44100_64/128/192` and downgrades automatically.

Pipeline evaluation — all 150 benchmark cases through `/api/voice/tts/plan`, no synthesis:

| check | result |
|---|---|
| cases planned | 150 / 150 |
| language detected as expected | 143 |
| routed to a model that lists that language | 150 |
| Telugu cases in native script after transliteration | 45 / 45 |
| romanised Telugu left in Latin script | 0 |
| cases needing a speech rewrite (numbers, money, code, markup) | 60 |

The 7 remaining detection misses are Spanish, French, German and Portuguese sentences: script
cannot identify them, so they read as English until the language is chosen explicitly. That is
the documented behaviour, not a claim of automatic detection.

`npm run speech:test` → **227 assertions, 0 failed**; `npm run speech:bench -- --plan-only`
reproduces the table above; `npx tsc --noEmit` is clean and `npm run build` succeeds.

---

## Mood, visible cues and adaptive tone

HYDRO's own face is a simulation. This layer is the opposite: it is what the app is
allowed to *measure* about the person using it, and it is deliberately small.

```
src/core/affect.ts          fusion, tone choice, prompt guidance, episode ledger
src/lib/voice/tone.ts       on-device microphone energy + pitch measurement
src/lib/useAffect.ts        consent, self-report, storage, tone directive
src/components/AffectPanel.tsx  readout, mood taps, breathing pacer, privacy controls
```

**Four sources, one cautious read.** Wording polarity (`appraise`), face action-unit
scores from the local landmark model (AU12, AU4, AU1, AU7, AU26, AU15), acoustic
measurements from the user's own microphone, and an explicit mood tap are combined
into a valence/arousal estimate. Confidence is *agreement × coverage*, so a single
neutral sentence cannot look like a confident reading of anyone's mood. Two sources
that disagree produce `uncertain` rather than an average of the two.

**Self-report wins.** If the user taps "Okay", a tense brow does not overrule them.
The mood is quoted in the prompt as their statement, never reinterpreted.

**Voice is activation only.** Pitch and loudness do not distinguish excitement from
distress, so the microphone contributes arousal and a cue list ("louder speech than
usual", "fast speech") but a valence of exactly zero. Speaking rate is words per
minute from the transcript over the recording length.

**Tone, not performance.** The fused read becomes a short system-prompt block for the
turn: supportive with shorter answers under strain, warm, playful or focused otherwise.
When confidence is below 0.35 and there is no self-report, the tone is forced to
neutral rather than acting on a guess. The block forbids claiming to see or know
anyone's emotions and forbids naming a condition.

**Local mood memory.** Off until the user enables it. Then at most 30 episodes live in
`localStorage` — mood taps, the reading, and a 90-character excerpt. A follow-up is
offered only for a self-reported stressed/low episode between 45 minutes and 14 days
old, phrased as the user's own request. "Delete mood log" clears it. The chat request
carries four fields (tone, stress, confidence, mood) and nothing else: no cues, no
audio, no image.

**Adaptive palette.** When measured strain is high and the preference is on, the stage
is desaturated (`data-calm`). It is a CSS filter on the render area only, the toggle is
in the panel, and it is off under `prefers-reduced-motion` transitions.

**Posture.** Shoulder tilt and a slow per-session shoulder baseline give an approximate
lean and settle value from the pose model. Both are labelled *approx* in the panel and
are cues, not posture assessment.

**Measured here.** `npm run affect:test` → **31 passed, 0 failed**: pitch estimation on
synthetic tones and rejection of silence/noise, empty and neutral reads, supportive vs.
playful tone selection, serious topics, self-report precedence and expiry, conflict →
check-in, voice valence pinned to zero, tense-face polarity and activation, approximate
posture cues, directive validation and clamping, prompt prohibitions, ledger bounds and
follow-up windows, and recommendation thresholds. The existing suites still pass
(interaction 72, vision 24, workspace 68), `tsc --noEmit` is clean and `npm run build`
succeeds.

**Not verified.** No physical camera or microphone exists on this machine. The acoustic
meter, the live cue path and the breathing pacer were compiled and unit-tested but not
exercised with a real voice or face, and the panel's visual layout was not inspected.

---

## Device intelligence: AI home, execution and procedural memory

HYDRO has its own workspace on disk and a small, permission-gated tool engine. It is deliberately
narrow: it can operate on files **inside its home**, read real system metrics, and replay
workflows it has been taught. It cannot run shell commands, launch applications or control the
screen.

```
.data/ai-home/            HYDRO_AI_HOME (configurable) — the assistant's own storage
  brain/ memory/ knowledge/ learning/ tools/ skills/ projects/ workspace/
  vision/ voice/ hologram/ backups/ diagnostics/ security/ updates/
  diagnostics/audit.log   every operation, including denials
  .trash/                 deletions are moves; restore by moving back

src/core/ai-home.ts       sandbox, quota, permission level, audit, system metrics
src/core/planner.ts       instruction → steps (deterministic, pure)
src/core/actions.ts       execution + read-back verification + history
src/core/workflows.ts     procedural memory: learn → approve → run
src/core/personal.ts      vocabulary aliases and custom gesture templates
src/components/WorkspacePanel.tsx   files, tasks, workflows, voice, permissions
```

### Permission levels

| Level | Name | Allows |
| --- | --- | --- |
| 1 | Observe | list, read, search, system metrics |
| 2 | Create | new files and folders (default) |
| 3 | Manage | overwrite, move, rename, move to trash |
| 4 | Sensitive system | **not grantable** — needs a native agent with administrator consent |

Levels are enforced server-side in one place (`levelAllows`), the level is stored in
`.data/execution-permissions.json`, and every change is audited. Level 4 requests are refused
with an explanation rather than a fake success.

### How an instruction runs

1. Your own phrase aliases expand the text.
2. The deterministic planner matches it to a tool, or leaves it alone (`handled: false`) so the
   conversation answers it instead of guessing.
3. Steps that overwrite or delete require a stored plan and an explicit approval — the browser
   only receives a plan id, never an editable step list.
4. Each step runs, then is **verified against the filesystem** (read-back for writes, existence
   checks for moves, source-gone/target-present for trash).
5. The run is written to `.data/executions.json` and `diagnostics/audit.log`.

In the conversation, an imperative message is offered to this engine first. If it matches, it
runs locally with **no model call** and the answer is the verified result. Otherwise the message
continues to the normal hybrid pipeline.

### Learned workflows

A workflow is learned from your own step-by-step narration. Each sentence becomes a step; only
steps that map to a real digital tool are marked executable, and the rest are stored as
unsupported description. Drafts are inert. Approving one makes it runnable, and “do the same
task again” replays the approved steps. No video understanding is involved, so a workflow is
never inferred from footage it cannot interpret.

### Personalisation

- **Phrase aliases** — “when I say X, I mean Y”. Expanded before planning; stored locally.
- **Custom gestures** — capture a hand pose from the vision panel, name it and attach a command.
  The pose is a 42-value normalised skeleton signature; matching is RMS distance under 0.22 with
  a 1.8 s debounce and the built-in classifier taking priority. A taught gesture can only run a
  reversible command you wrote yourself.

### Verified in this environment

- `npm run workspace:test` — **51 passed, 0 failed** on a throwaway home: traversal and absolute
  paths refused, credential-shaped filenames blocked, create/read/list/search/move/trash round
  trip, level gating, level 4 refusal, quota enforcement, 14 planner cases, pose invariance and
  matching, audit trail.
- Live API run: a file was created and verified, deletion was blocked at level 2, approved and
  executed at level 3 into `.trash`, a two-step workflow was learned (2/2 executable), approved
  and run, an alias executed correctly, `system.info` returned real `win32` metrics, and
  `../../outside.txt` was refused with **403**.
- In the UI, typing “create a file called fromchat.md” produced the verified result in the
  conversation without calling a model.

---

## Environmental awareness

Every turn measures the machine it is running on, and that measurement travels with the
system prompt (`src/core/environment.ts`):

| Fact | Source |
| --- | --- |
| Local time and timezone | the server clock and `Intl` |
| Platform, arch, CPU count, free/total memory, uptime | `os` via `systemInfo()` |
| Permission level and its human-readable name | the existing permission file |
| Consented memory records and proposals awaiting approval | the memory store |
| Last device run, whether it succeeded, and its instruction | the execution history |
| Speech and search availability | the configured provider keys (presence only) |
| Connectivity and battery | **reported by the browser** — the server cannot read them |

The block is explicitly bounded: the model is told to use it only for timing, resource
and offline-aware decisions, not to recite it, not to infer a location from the clock,
and never to claim control it was not granted. Battery level is clamped in `normalizeDevice`
because a page can claim any number, and a fact that could not be read is left out rather
than replaced with a plausible value — an unknown battery simply does not appear.

Measured: `npm run workspace:test` asserts the real platform and CPU count, that free
memory is within total, that browser facts reach the block, that offline is reported,
that an unknown battery is omitted, that no configured key appears in the block, that
malformed facts are rejected and clamped, and that the block reaches the system prompt
only when it is non-empty.

## Security model

- Provider credentials are server-only and never serialized to the client.
- Retrieved web content and model output are treated as **untrusted data**; the evidence
  prompt says so explicitly and citations are numbered.
- Hard per-request call and spend ceilings are enforced in code before every call.
- Circuit breakers open after repeated model failures so a dead provider stops consuming budget.
- Markdown renders to React elements — never `dangerouslySetInnerHTML`.
- Evolution is propose-only: it cannot generate code, deploy, change permissions or read
  credentials. Approval is a human action and is reversible and audited.

**Known limitation:** this is single-tenant. There is no authentication layer, so it must not
be exposed to the public internet as-is. Adding accounts means scoping `user_id` across the
store before any multi-user deployment.

---

## Accessibility

- Semantic landmarks, labelled controls, `aria-live` on the genesis sequence.
- Visible `:focus-visible` rings throughout; keyboard-only operation of the whole app.
- `prefers-reduced-motion` disables the genesis cinematic, the orb animation and all CSS transitions.
- 44px minimum touch targets, mobile safe-area insets, text down to 10.5px only for meta labels.

---

## Honest limitations

The blueprint describes a much larger system than one session can deliver. These parts are
**specified but not built**, and are deliberately not faked:

- **The 154-language catalogue** — no such catalogue is generated here. The stack is
  TypeScript on both sides; that is the whole truth.
- **The 50-animation component library as standalone reversible modules** — the hologram,
  genesis, streaming, state machine, reduced-motion and adaptive-quality systems exist and
  are wired in, but they are not packaged as an installable library.
- **Self-hosted/local models (Ollama, vLLM), pgvector semantic memory, Postgres tenancy** —
  the memory layer is keyword retrieval over a JSON store.
- **Sandboxed code execution** — there is no execution runtime, so nothing claims to have run code.
- **Canary deployment and automatic rollback** — the approval ledger and manual rollback exist;
  automated canary release does not.
- **Benchmark report** — no pre-registered evaluation was run. The three numbers in the table
  above are latency and cost of real requests, not quality measurements.
- **Account system, billing, usage quotas per user** — not implemented.
- **Measured lip sync** — the viseme timeline is derived from the text, then scaled by real
  audio amplitude. It is not a phoneme alignment of the returned audio, and there is no
  glTF/VRM morph-target asset: the shapes are analytic shader deformations.
- **Facial-expression recognition** — MediaPipe blendshapes are mirrored as visible cues and
  now feed the affect layer as weighted *cues*, but there is no trained expression classifier
  and no emotion label is ever attached to the user. A smile can be politeness; a lowered brow
  can be screen glare. The panel says "cues" and shows a confidence value, and disagreement
  produces a question instead of a verdict.
- **Trained sentiment or voice-emotion models** — the wording pass is a deterministic lexicon
  with negation, and the voice path measures energy and pitch. Neither is a trained
  classifier, and no emotional data is sent to a server or stored in a database.
- **Cloud or cross-device mood history** — episodes are per-browser `localStorage`, so they do
  not sync and are lost if site data is cleared. There is no server-side emotion store by design.
- **Full-body animation** — there is no skeleton. Posture is head pitch/roll, sway and
  breathing; hands are reported as landmarks and gestures, not rigged limbs.
- **Spatial/AR modes, WebXR, surface detection, occlusion, spatial audio** — not implemented;
  the app never claims physical holographic projection.
- **Object, scene, document and text recognition while tracking** — the continuous loop reports
  landmarks only. Deeper understanding happens only when a frame is attached to a question or
  through “Ask what I see”, and the prompt restricts answers to what that one frame shows.
- **Pinch-to-select, point-to-object disambiguation, gesture calibration** — the poses are
  detected and displayed but not wired to actions.
- **Camera accuracy claims** — no face/hand accuracy, low-light or multi-person benchmark was
  run. This environment has no physical camera, so the live tracking path was not exercised
  end-to-end; only the classifier, the asset delivery and the vision request were tested.
- **Python/OpenCV/ONNX backend, pgvector memory, WebGPU/WGSL, skeletal GLTF animation** — the
  entire stack is TypeScript + WebGL2 + MediaPipe wasm. No Python service runs.
- **Shell, PowerShell, cmd, application launching, screen reading, mouse/keyboard control,
  software installation** — not implemented. The execution engine has no process-spawning tool at
  all. Doing this safely needs a separate native agent, explicit elevation and its own consent
  flow; exposing it through a web request would be a security hole, not a feature.
- **Windows UI Automation, a floating desktop overlay, startup integration, Android/iOS apps,
  cross-device sync, local LLM/offline inference** — not implemented. This is a Next.js web app
  on one machine.
- **AR/WebXR, surface detection, spatial anchoring, occlusion, spatial audio** — not implemented.
  The camera mode is a screen-space composite, not a spatial system.
- **Object/document recognition, action recognition in video, learning a workflow by watching** —
  the tracking loop returns landmarks only, and there is no local object detector: object, colour,
  gesture and text answers come from a multimodal model on one frame. Workflows are learned from
  narration. No frame is ever stored or streamed to a provider.
- **Task execution beyond the AI home** — the sandbox is the feature. Files elsewhere on the
  machine, environment files, keys and other applications' data are unreachable by design.
- **Long-term memory layers in a database** — memory is still keyword retrieval over a JSON
  document plus the new workflow/alias/gesture files. No embeddings, no pgvector, no per-user
  isolation.

- **Voice naturalness ratings** — nobody listened to the output while building this, so there is
  no MOS score, no preference test and no "sounds X% more natural" claim. What is reported is
  what can be measured without ears: character error rate after a round trip through speech
  recognition, model latency, and whether the plan routes each sentence to a model that lists
  its language.
- **The 150-case audio benchmark is incomplete.** The suite exists (`scripts/speech-bench.mjs`,
  150 cases across Telugu, English, Hindi, mixed and edge-case input, with a paired
  before/after comparison), but the run against the speech provider stopped after 51 cases: the
  account's 10,000-credit allowance was used up. The 4 pairs that completed, plus the model
  matrix in the voice section, are the full extent of the audio measurements.
- **No native Telugu voice exists in this account.** All 21 available voices are English
  mother-tongue. Telugu is spoken by a multilingual model with English-accented stress on
  English words; the plan reports this through `voiceNotice` and the Voice tab repeats it
  rather than pretending a native voice is selected.
- **Latin-script languages other than English are not auto-detected.** Spanish, French, German
  and Portuguese text reads as English until the language is chosen in Settings → Voice. There
  is no language-identification model in this pipeline, only script and lexical detection.
- **Synthesis currently returns 402 from the provider** because the account is out of credits.
  The error is labelled as a quota problem, not a bad key, and the client falls back to the
  browser's speech engine — which on this machine has no Telugu voice either.
- **Telugu speech recognition was not exercised with a real microphone.** This machine has no
  microphone permission, so the `multi`-language Deepgram path, keyterm boosting and confidence
  handling are compiled and unit-tested but unheard.
- **Provider choice is narrow.** Only ElevenLabs is wired up. No open-weight model was
  installed locally, so the "local, licensed model" option in the brief was evaluated and
  rejected on deployment grounds (no GPU runtime, no Workers-compatible server), not benchmarked.

Nothing in the interface displays an IQ score, an emotion meter or a consciousness indicator,
and no visual observation is invented when the camera is off, blocked or unavailable.

---

## Deployment notes

The app is a standard Next.js 15 App Router project on the Node runtime (it uses `node:fs`
for the memory store), so any Node host works:

```bash
npm ci
npm run build
npm start          # serves on :3000
```

Before exposing it anywhere: add authentication, move the store to Postgres or SQLite with
per-user rows, set `HYDRO_MAX_CALLS` / `HYDRO_BUDGET_USD` to ceilings you are willing to pay,
and rotate the API keys. Vercel is unsuitable for the file-backed store without swapping
`src/core/memory.ts` for a managed database.

---

## License

Unlicensed prototype. Third-party providers have their own terms, data-retention policies and
costs; review them before handling other people's data.

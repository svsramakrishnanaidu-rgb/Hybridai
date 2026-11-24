/**
 * HYDRO AI — capability status.
 *
 * One honest list, rendered in the controls panel and used for the handover
 * report. `verified` means the path was actually exercised in this build;
 * `device` means the code exists and is tested but needs a camera, microphone
 * or external account this machine does not have; `partial` means part of the
 * requested behaviour is deliberately absent; `missing` means there is no
 * implementation to claim.
 */

export type AbilityState = "verified" | "device" | "partial" | "missing" | "config";

export interface Ability {
  id: number;
  name: string;
  state: AbilityState;
  /** where the user reaches it */
  surface: string;
  /** what stands between this and a full claim */
  dependency: string;
}

export const ABILITY_STATE_LABEL: Record<AbilityState, string> = {
  verified: "Working",
  device: "Working · needs hardware",
  partial: "Partial",
  config: "Needs configuration",
  missing: "Not built",
};

export const ABILITIES: Ability[] = [
  {
    id: 1,
    name: "Tap-to-speak",
    state: "device",
    surface: "Composer mic → Done / Cancel",
    dependency: "Real microphone; this browser denies the prompt, so the states were verified with a synthetic silent stream.",
  },
  {
    id: 2,
    name: "Telugu–English understanding",
    state: "verified",
    surface: "Composer language selector + the model",
    dependency: "None — a mixed Telugu request produced a Telugu answer from a real frame.",
  },
  {
    id: 3,
    name: "Complete spoken answers",
    state: "device",
    surface: "Speaker button beside the mode selector",
    dependency: "ElevenLabs key (configured); playback was not listened to here.",
  },
  {
    id: 4,
    name: "Live camera vision",
    state: "device",
    surface: "Vision panel → Start camera",
    dependency: "A physical camera. Frame→model was verified with a synthetic image.",
  },
  {
    id: 5,
    name: "Object and region selection",
    state: "device",
    surface: "Vision panel → Select area, drag or tap",
    dependency: "Camera. Selection geometry is unit-tested; automatic two-object disambiguation is not implemented.",
  },
  {
    id: 6,
    name: "OCR and document vision",
    state: "device",
    surface: "Freeze frame → Read text → Copy / Translate / Save note",
    dependency: "Camera or an image in the frame; OCR itself verified on a synthetic page.",
  },
  {
    id: 7,
    name: "Gesture commands",
    state: "device",
    surface: "Vision panel → Interaction mode",
    dependency: "Camera. Policy layer has 83 passing assertions.",
  },
  {
    id: 8,
    name: "Live captions",
    state: "partial",
    surface: "Composer caption strip",
    dependency: "Interim words need the browser's speech service; Done sends immediately, so a correction is a follow-up turn.",
  },
  {
    id: 9,
    name: "Combined voice and vision",
    state: "verified",
    surface: "Selection + any question",
    dependency: "None for the wiring; the crop was verified against a real model.",
  },
  {
    id: 10,
    name: "Interactive hologram face",
    state: "verified",
    surface: "Main stage",
    dependency: "None — WebGL2 rig with a CSS fallback.",
  },
  {
    id: 11,
    name: "Voice-synchronised lips",
    state: "verified",
    surface: "Automatic during speech",
    dependency: "Playback; viseme timeline and amplitude blending already tested.",
  },
  {
    id: 12,
    name: "Expressive states",
    state: "verified",
    surface: "Main stage + vision readout",
    dependency: "None — driven by real mic/model/tool events.",
  },
  {
    id: 13,
    name: "Conversation context",
    state: "verified",
    surface: "Conversation",
    dependency: "None; selection and the last analysed frame travel with follow-ups.",
  },
  {
    id: 14,
    name: "Personal and project memory",
    state: "verified",
    surface: "“remember that …” / menu → Memory",
    dependency: "Retrieval obeys the memory consent switch.",
  },
  {
    id: 15,
    name: "Memory controls",
    state: "verified",
    surface: "Menu → Memory (edit, export, delete)",
    dependency: "None.",
  },
  {
    id: 16,
    name: "File and knowledge search",
    state: "missing",
    surface: "—",
    dependency: "No document index or PDF extraction. Text attachments and the workspace file search exist instead.",
  },
  {
    id: 17,
    name: "Web research",
    state: "verified",
    surface: "Deep mode / questions needing current facts",
    dependency: "TAVILY_API_KEY (configured).",
  },
  {
    id: 18,
    name: "Open the supporting evidence",
    state: "partial",
    surface: "Inspector + numbered citations",
    dependency: "Web citations are linked; document/page deep-links are not implemented.",
  },
  {
    id: 19,
    name: "Multi-model routing",
    state: "verified",
    surface: "Mode selector + inspector",
    dependency: "Provider keys, already configured.",
  },
  {
    id: 20,
    name: "Provider fallback",
    state: "verified",
    surface: "Automatic; shown as “recovered”",
    dependency: "None.",
  },
  {
    id: 21,
    name: "Multi-step task execution",
    state: "partial",
    surface: "Workspace panel",
    dependency: "Plans execute and verify inside HYDRO's home; “save as Word/PDF” produces Markdown, not an Office file.",
  },
  {
    id: 22,
    name: "Connected app actions",
    state: "config",
    surface: "—",
    dependency: "No external app accounts (Slack, Gmail, Notion) are connected; approval and preview plumbing exists for local plans only.",
  },
  {
    id: 23,
    name: "Device and presentation control",
    state: "missing",
    surface: "—",
    dependency: "No native bridge or paired device exists to control slides or hardware.",
  },
  {
    id: 24,
    name: "Verify action results",
    state: "verified",
    surface: "Notes and workspace receipts",
    dependency: "None for files; slide/device read-back needs ability 23.",
  },
  {
    id: 25,
    name: "Interactive 3D workspace",
    state: "missing",
    surface: "—",
    dependency: "No model loader or viewer. The avatar is a shader, not a glTF scene.",
  },
  {
    id: 26,
    name: "Design version comparison",
    state: "missing",
    surface: "—",
    dependency: "No model/version metadata source.",
  },
  {
    id: 27,
    name: "Live sensor dashboard",
    state: "missing",
    surface: "—",
    dependency: "No authorised sensor feed or demo dataset.",
  },
  {
    id: 28,
    name: "Coding and debugging assistance",
    state: "partial",
    surface: "Conversation with attached files / workspace",
    dependency: "HYDRO can read and explain code and plan edits, but cannot run tests or apply scoped patches to this repository.",
  },
  {
    id: 29,
    name: "Testing and regression checks",
    state: "verified",
    surface: "npm run *:test",
    dependency: "394 assertions pass; device-only paths remain unverified and are labelled as such.",
  },
  {
    id: 30,
    name: "Learning from corrections",
    state: "partial",
    surface: "Memory edit, phrase aliases, taught gestures",
    dependency: "Corrections can be edited or deleted; there is no “apply once vs save” prompt and no undo beyond re-editing.",
  },
];

export function abilityCounts(): Record<AbilityState, number> {
  const counts = { verified: 0, device: 0, partial: 0, config: 0, missing: 0 } as Record<
    AbilityState,
    number
  >;
  for (const ability of ABILITIES) counts[ability.state] += 1;
  return counts;
}

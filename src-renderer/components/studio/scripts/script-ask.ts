// Puts text in Ask Roz's message box without sending it, so the user can add context. The panel owns the box and
// picks the text up when it mounts if it is still opening; text already in the box is kept.
export { prefillAssist as prefillAssistComposer } from "./ScriptAssistPanel";

import { createPersonalitiesExtension } from "./index.ts";

// Child-only entry point: no inherited default; select a non-Waldemar identity
// with pi-subagents' extensionBindings for both foreground and background runs.
export default createPersonalitiesExtension(undefined, true);

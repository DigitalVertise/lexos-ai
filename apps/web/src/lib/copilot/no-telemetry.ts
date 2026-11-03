// Imported first by the CopilotKit route, before the runtime package loads:
// CopilotKit's runtime sends usage telemetry unless this flag is set, and a
// legal workspace should not report anything to a third party by default.
// Set COPILOTKIT_TELEMETRY_DISABLED=false in the environment to opt back in.
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= "true";

export {};

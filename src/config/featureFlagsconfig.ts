// src/config/featureFlagsconfig.ts
export interface FeatureFlags {
  moderationEnabled: boolean;           // Master toggle for the entire moderation layer
  moderationLiteEnabled: boolean;       // Toggle for frontend lite model (fallback to backend if off)
  moderationTelemetryEnabled: boolean;  // Toggle for sending telemetry
  moderationOverrideEnabled: boolean;   // Toggle for allowing reviews/overrides
}

// Helper: read a NEXT_PUBLIC_* flag with a sensible default
function flag(envVar: string | undefined, defaultValue: boolean): boolean {
  if (envVar === 'true') return true;
  if (envVar === 'false') return false;
  return defaultValue;
}

// Default flags (before rollout bucketing is applied)
export const defaultFlags: FeatureFlags = {
  // By default we consider moderation "on", and let rollout decide who actually gets it
  moderationEnabled: flag(process.env.NEXT_PUBLIC_MODERATION_ENABLED, true),

  // Lite model on by default; can be forced off via env
  moderationLiteEnabled: flag(process.env.NEXT_PUBLIC_MODERATION_LITE_ENABLED, true),

  // Telemetry + override on by default in dev; can be disabled if needed
  moderationTelemetryEnabled: flag(
    process.env.NEXT_PUBLIC_MODERATION_TELEMETRY_ENABLED,
    true,
  ),
  moderationOverrideEnabled: flag(
    process.env.NEXT_PUBLIC_MODERATION_OVERRIDE_ENABLED,
    true,
  ),
};

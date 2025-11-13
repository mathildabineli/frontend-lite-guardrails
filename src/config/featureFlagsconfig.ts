// src/config/featureFlags.ts
export interface FeatureFlags {
  moderationEnabled: boolean; // Master toggle for the entire moderation layer
  moderationLiteEnabled: boolean; // Toggle for frontend lite model (fallback to backend if off)
  moderationTelemetryEnabled: boolean; // Toggle for sending telemetry
  moderationOverrideEnabled: boolean; // Toggle for allowing reviews/overrides
}

// Default flags (can be overridden by env vars or runtime)
export const defaultFlags: FeatureFlags = {
  moderationEnabled: process.env.NEXT_PUBLIC_MODERATION_ENABLED === 'true' || false,
  moderationLiteEnabled: process.env.NEXT_PUBLIC_MODERATION_LITE_ENABLED === 'true' || true,
  moderationTelemetryEnabled: process.env.NEXT_PUBLIC_MODERATION_TELEMETRY_ENABLED === 'true' || true,
  moderationOverrideEnabled: process.env.NEXT_PUBLIC_MODERATION_OVERRIDE_ENABLED === 'true' || true,
};




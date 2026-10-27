import { on, created, MockError } from "../engine";
import { freshId } from "../ids";
import type { Store } from "../store";

// The rest of the workspace: people, research, support and settings. Mostly read-only for now; a screen that
// needs more says so in plain words until its handler is added here.

const W = "/v1/workspaces/{workspaceId}";
const now = () => new Date().toISOString();
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const entitlements = {
  aiBudgetUsd: 5,
  recordings: true,
  apiKeys: 3,
  publicPages: true,
  digest: true,
  surveys: true,
  integrations: true,
  modules: ["feedback", "research", "surveys", "support"] as (
    "feedback" | "research" | "surveys" | "support"
  )[],
};

// ---- people
// ---- team and settings
// ---- research
// ---- support
void ({} as Store);

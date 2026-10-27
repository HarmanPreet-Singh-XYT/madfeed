import type { ReactNode } from "react";

// Shown only in a preview build, so nobody mistakes fake data for the real thing. Everywhere else it renders
// nothing. A preview build swaps this file for mock/preview-badge.tsx. Import it as "@/components/preview-badge".
export function PreviewBadge(): ReactNode {
  return null;
}

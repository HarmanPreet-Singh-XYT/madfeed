import "server-only";
import { notFound } from "next/navigation";

// Pages under /mock exist only in a preview build (a design-work build with fake data; see mock/README.md).
// In every other build this makes them answer "not found". A preview build swaps this file for
// mock/preview.ts. Always import it as "@/lib/server/preview".
export function assertPreview(): void {
  notFound();
}

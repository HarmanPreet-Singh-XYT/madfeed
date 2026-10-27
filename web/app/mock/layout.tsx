import { assertPreview } from "@/lib/server/preview";

// Everything under /mock exists only in a preview build; anywhere else this answers "not found".
export default function MockLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  assertPreview();
  return <>{children}</>;
}

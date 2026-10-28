// The frame around a screen depends on where it is: a workspace screen gets the sidebar (see
// w/[workspaceId]/layout.tsx), and the few screens outside a workspace use StandaloneFrame themselves.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

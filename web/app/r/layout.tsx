// The public release pages: no sign-in, no app chrome, nothing about the
// workspace except what it chose to publish.
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      {children}
    </main>
  );
}

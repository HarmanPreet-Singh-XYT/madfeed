// The public release pages: no sign-in, no app chrome, nothing about the
// workspace except what it chose to publish. Each page draws its own hero and column (components/app/public-hero).
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="w-full flex-1">
      {children}
    </main>
  );
}

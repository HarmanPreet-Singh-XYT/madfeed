import { LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { SubmitButton } from "@/components/submit-button";

/** Sign out, and on phones (where there is no top bar) the light and dark switch too. */
export function AccountFooter({ withTheme = false }: { withTheme?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <form
        action={signOut}
        className="flex-1 [&_button]:w-full [&_button]:justify-start [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-2 [&_button]:text-[13px] [&_button]:font-normal [&_button]:text-muted-foreground [&_button]:shadow-none [&_button]:hover:bg-accent/60 [&_button]:hover:text-foreground"
      >
        <SubmitButton variant="plain" pendingLabel="Signing out…">
          <span className="inline-flex items-center gap-2.5">
            <LogOut aria-hidden="true" className="size-4" />
            Sign out
          </span>
        </SubmitButton>
      </form>
      {withTheme ? <ThemeToggle /> : null}
    </div>
  );
}

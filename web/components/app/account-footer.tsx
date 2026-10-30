import { LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { SubmitButton } from "@/components/submit-button";

/** Sign out, and on phones (where there is no top bar) the light and dark switch too. It sits on the navy sidebar. */
export function AccountFooter({ withTheme = false }: { withTheme?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <form action={signOut} className="flex-1">
        <SubmitButton
          variant="plain"
          size="default"
          pendingLabel="Signing out…"
          className="h-9 w-full rounded-lg! justify-start border-0 bg-transparent dark:bg-transparent dark:hover:bg-accent/70 px-2.5 font-normal text-foreground/80 shadow-none hover:bg-accent/70 hover:text-foreground pointer-coarse:h-11"
        >
          <span className="inline-flex items-center gap-2.5">
            <LogOut aria-hidden="true" className="size-4 text-muted-foreground" />
            Sign out
          </span>
        </SubmitButton>
      </form>
      {withTheme ? (
        <span className="text-foreground [&_button]:hover:bg-accent/70">
          <ThemeToggle />
        </span>
      ) : null}
    </div>
  );
}

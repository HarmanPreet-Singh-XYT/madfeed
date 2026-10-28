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
          pendingLabel="Signing out…"
          className="w-full justify-start border-0 bg-transparent px-3 font-normal text-on-brand/75 shadow-none hover:bg-on-brand/10 hover:text-on-brand"
        >
          <span className="inline-flex items-center gap-3">
            <LogOut aria-hidden="true" className="size-4.5" />
            Sign out
          </span>
        </SubmitButton>
      </form>
      {withTheme ? (
        <span className="text-on-brand [&_button]:text-on-brand [&_button]:hover:bg-on-brand/10">
          <ThemeToggle />
        </span>
      ) : null}
    </div>
  );
}

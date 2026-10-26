// Command accountdeletion is the operator's side of "delete my account". People ask from Settings; this lists
// the requests and, when you run complete, removes the person from the app (memberships, API keys, assistant
// connections, votes). Deleting the sign-in account itself is a step only you can do, in the identity service's
// dashboard, because this app never holds its admin key.
//
//	DATABASE_ADMIN_URL=postgres://... go run ./cmd/accountdeletion list
//	DATABASE_ADMIN_URL=postgres://... go run ./cmd/accountdeletion complete [-keep-workspaces] <request id>
//
// The URL must be a role that bypasses row-level security (the one used to migrate).
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/account"
)

func main() {
	url := os.Getenv("DATABASE_ADMIN_URL")
	if url == "" || len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: DATABASE_ADMIN_URL=... accountdeletion list | complete [-keep-workspaces] <request id>")
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot connect:", err)
		os.Exit(1)
	}
	defer pool.Close()
	switch os.Args[1] {
	case "list":
		list, err := account.ListOpen(ctx, pool)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if len(list) == 0 {
			fmt.Println("no open requests")
		}
		for _, p := range list {
			fmt.Printf("%s  asked %s  user %s  %s\n", p.ID, p.RequestedAt.Format("2006-01-02"), p.UserID, p.Email)
			for _, m := range p.Workspaces {
				note := ""
				switch {
				case m.LastAdmin:
					note = "  <- last admin, others use it"
				case m.Alone:
					note = "  <- only member"
				}
				fmt.Printf("    %s (%s)%s\n", m.Name, m.Role, note)
			}
		}
	case "complete":
		fs := flag.NewFlagSet("complete", flag.ExitOnError)
		keep := fs.Bool("keep-workspaces", false, "allow leaving workspaces they alone belong to")
		_ = fs.Parse(os.Args[2:])
		id, err := uuid.Parse(fs.Arg(0))
		if err != nil {
			fmt.Fprintln(os.Stderr, "give the request id from `list`")
			os.Exit(2)
		}
		p, err := account.Complete(ctx, pool, id, *keep)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Printf("Removed from the app: user %s.\nNow delete that user in the identity service (Supabase dashboard, Authentication, Users), then tell them it is done.\n", p.UserID)
	default:
		fmt.Fprintln(os.Stderr, "unknown command")
		os.Exit(2)
	}
}

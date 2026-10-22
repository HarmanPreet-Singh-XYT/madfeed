// Command migrate brings the database schema up to date: application tables
// (goose) and the job queue (River), then grants the restricted application
// role access. Run it with a privileged URL; the API and worker never get one.
//
//	DATABASE_ADMIN_URL=postgres://... go run ./cmd/migrate
//
// Creating the application's login role (and its password) is deliberately not
// done here, so no secret lives in the repo:
//
//	CREATE ROLE app_api LOGIN PASSWORD '...' IN ROLE app_backend NOSUPERUSER NOBYPASSRLS;
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"

	"product/api/internal/jobs"
	"product/api/migrations"
)

func main() {
	url := os.Getenv("DATABASE_ADMIN_URL")
	if url == "" {
		log.Fatal("DATABASE_ADMIN_URL is required (a privileged role; not the application role)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if err := run(ctx, url); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, url string) error {
	db, err := sql.Open("pgx", url)
	if err != nil {
		return err
	}
	defer db.Close()
	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		return fmt.Errorf("schema migrations: %w", err)
	}

	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return err
	}
	defer pool.Close()
	if _, err := pool.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS `+jobs.Schema); err != nil {
		return err
	}
	m, err := rivermigrate.New[pgx.Tx](riverpgxv5.New(pool), &rivermigrate.Config{Schema: jobs.Schema})
	if err != nil {
		return err
	}
	if _, err := m.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return fmt.Errorf("job queue migrations: %w", err)
	}
	for _, q := range []string{
		`GRANT USAGE ON SCHEMA ` + jobs.Schema + ` TO app_backend`,
		`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ` + jobs.Schema + ` TO app_backend`,
		`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ` + jobs.Schema + ` TO app_backend`,
		`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ` + jobs.Schema + ` TO app_backend`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			return err
		}
	}
	log.Println("database is up to date")
	return nil
}

// Package testdb starts one real Postgres (with pgvector) per test process,
// applies the embedded migrations as a superuser, and hands out a pool that
// connects as the restricted backend role, exactly like production.
package testdb

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"product/api/internal/jobs"
	"product/api/migrations"
)

const (
	image       = "pgvector/pgvector:pg18"
	backendUser = "app_api"
	backendPass = "test-only-backend-password"
)

// DB bundles the connections tests need.
type DB struct {
	Super                *pgxpool.Pool // superuser: migrations, assertions, setup only
	Backend              *pgxpool.Pool // restricted role, RLS applies
	SuperDSN, BackendDSN string
}

var (
	once    sync.Once
	shared  *DB
	initErr error
)

// New returns the shared test database, starting it on first use. Tests are
// skipped when no container runtime is available.
func New(t *testing.T) *DB {
	t.Helper()
	testcontainers.SkipIfProviderIsNotHealthy(t)
	once.Do(func() { shared, initErr = start() })
	if initErr != nil {
		t.Fatalf("start test database: %v", initErr)
	}
	return shared
}

func start() (*DB, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	c, err := postgres.Run(ctx, image,
		postgres.WithDatabase("app"), postgres.WithUsername("postgres"), postgres.WithPassword("postgres"),
		postgres.BasicWaitStrategies(),
		testcontainers.WithWaitStrategy(wait.ForListeningPort("5432/tcp").WithStartupTimeout(2*time.Minute)),
	)
	if err != nil {
		return nil, err
	}
	superDSN, err := c.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		return nil, err
	}

	sdb, err := sql.Open("pgx", superDSN)
	if err != nil {
		return nil, err
	}
	defer sdb.Close()
	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return nil, err
	}
	if err := goose.UpContext(ctx, sdb, "."); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if _, err := sdb.ExecContext(ctx, fmt.Sprintf(
		`CREATE ROLE %s LOGIN PASSWORD '%s' IN ROLE app_backend NOSUPERUSER NOBYPASSRLS`, backendUser, backendPass)); err != nil {
		return nil, err
	}

	super, err := pgxpool.New(ctx, superDSN)
	if err != nil {
		return nil, err
	}
	host, err := c.Host(ctx)
	if err != nil {
		return nil, err
	}
	port, err := c.MappedPort(ctx, "5432/tcp")
	if err != nil {
		return nil, err
	}
	backendDSN := fmt.Sprintf("postgres://%s:%s@%s:%s/app?sslmode=disable", backendUser, backendPass, host, port.Port())
	backend, err := pgxpool.New(ctx, backendDSN)
	if err != nil {
		return nil, err
	}
	return &DB{Super: super, Backend: backend, SuperDSN: superDSN, BackendDSN: backendDSN}, nil
}

var riverOnce sync.Once

// EnableRiver installs River's schema (as the privileged role) and grants the
// backend role DML on it, once per process.
func (d *DB) EnableRiver(t *testing.T) {
	t.Helper()
	var err error
	riverOnce.Do(func() {
		ctx := context.Background()
		if _, err = d.Super.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS `+jobs.Schema); err != nil {
			return
		}
		var m *rivermigrate.Migrator[pgx.Tx]
		if m, err = rivermigrate.New(riverpgxv5.New(d.Super), &rivermigrate.Config{Schema: jobs.Schema}); err != nil {
			return
		}
		if _, err = m.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
			return
		}
		for _, q := range []string{
			`GRANT USAGE ON SCHEMA ` + jobs.Schema + ` TO app_backend`,
			`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ` + jobs.Schema + ` TO app_backend`,
			`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ` + jobs.Schema + ` TO app_backend`,
			`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ` + jobs.Schema + ` TO app_backend`,
		} {
			if _, err = d.Super.Exec(ctx, q); err != nil {
				return
			}
		}
	})
	if err != nil {
		t.Fatalf("enable river: %v", err)
	}
}

// Package migrations embeds the goose SQL files so tests and the binary run
// exactly the same schema.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS

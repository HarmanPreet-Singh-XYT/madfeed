package publicsite

import "github.com/jackc/pgx/v5/pgtype"

func pgxText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }

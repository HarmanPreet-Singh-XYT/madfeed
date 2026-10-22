package review

import "github.com/jackc/pgx/v5/pgtype"

func nullFloat(f float32) pgtype.Float4 { return pgtype.Float4{Float32: f, Valid: true} }

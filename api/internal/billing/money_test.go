package billing

import "testing"

func TestMoneyUsesTheCurrencysOwnUnits(t *testing.T) {
	for _, c := range []struct {
		minor int64
		cur   string
		want  string
	}{
		{1999, "usd", "19.99 USD"},
		{500, "jpy", "500 JPY"},
		{-250, "eur", "-2.50 EUR"},
		{5, "usd", "0.05 USD"},
	} {
		if got := money(c.minor, c.cur); got != c.want {
			t.Errorf("money(%d, %s) = %q, want %q", c.minor, c.cur, got, c.want)
		}
	}
}

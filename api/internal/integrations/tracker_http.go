package integrations

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// callJSON makes one request to a tracker's API and decodes a JSON answer. The address is built by the driver
// from fixed bases plus identifiers it has validated; nothing a person typed is used as a host. The answer's
// body is never put in an error: it can echo what was sent.
func (s *Service) callJSON(ctx context.Context, method, url string, header map[string]string, body any, out any) (int, error) {
	var rdr io.Reader
	if body != nil {
		if raw, ok := body.([]byte); ok {
			rdr = bytes.NewReader(raw)
		} else {
			b, _ := json.Marshal(body)
			rdr = bytes.NewReader(b)
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, url, rdr)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "feedback-app")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := s.client().Do(req)
	if err != nil {
		return 0, fmt.Errorf("could not reach the service")
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if out != nil && res.StatusCode < 300 && res.StatusCode != http.StatusNonAuthoritativeInfo && len(raw) > 0 { // 203 is a sign-in page, not data
		if err := json.Unmarshal(raw, out); err != nil {
			return res.StatusCode, fmt.Errorf("the service answered in a way we could not read")
		}
	}
	return res.StatusCode, nil
}

func hmacHex(secret string, body []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(body)
	return hex.EncodeToString(m.Sum(nil))
}

func sameHex(a, b string) bool {
	return hmac.Equal([]byte(strings.ToLower(strings.TrimSpace(a))), []byte(strings.ToLower(strings.TrimSpace(b))))
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func digest(body []byte) string {
	h := sha256.Sum256(body)
	return hex.EncodeToString(h[:])[:40]
}

// authFailure is what a driver returns when the service refuses the credentials.
type authFailure struct{ Service string }

func (e authFailure) Error() string { return e.Service + " did not accept those credentials" }

func itoa(n int) string { return strconv.Itoa(n) }

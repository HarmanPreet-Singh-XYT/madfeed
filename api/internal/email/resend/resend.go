// Package resend sends mail through the Resend HTTP API.
// Unverified against the live service until a key is configured (Gate 0).
package resend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"product/api/internal/email"
)

const defaultBase = "https://api.resend.com"

type Client struct {
	apiKey  string
	baseURL string
	http    *http.Client
}

// New returns a client. baseURL may be empty (production) or a test server.
func New(apiKey, baseURL string) (*Client, error) {
	if apiKey == "" {
		return nil, errors.New("resend: API key required")
	}
	if baseURL == "" {
		baseURL = defaultBase
	}
	return &Client{apiKey: apiKey, baseURL: baseURL, http: &http.Client{Timeout: 15 * time.Second}}, nil
}

type payload struct {
	From    string              `json:"from"`
	To      []string            `json:"to"`
	Subject string              `json:"subject"`
	Text    string              `json:"text,omitempty"`
	HTML    string              `json:"html,omitempty"`
	ReplyTo string              `json:"reply_to,omitempty"`
	Tags    []map[string]string `json:"tags,omitempty"`
	Headers map[string]string   `json:"headers,omitempty"`
}

func (c *Client) Send(ctx context.Context, m email.Message) (string, error) {
	if len(m.To) == 0 || m.From == "" || m.Subject == "" || (m.Text == "" && m.HTML == "") {
		return "", fmt.Errorf("%w: from, to, subject and a body are required", email.ErrPermanent)
	}
	if m.IdempotencyKey == "" {
		return "", fmt.Errorf("%w: idempotency key required", email.ErrPermanent)
	}
	p := payload{From: m.From, To: m.To, Subject: m.Subject, Text: m.Text, HTML: m.HTML, ReplyTo: m.ReplyTo, Headers: m.Headers}
	for k, v := range m.Tags {
		p.Tags = append(p.Tags, map[string]string{"name": k, "value": v})
	}
	body, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/emails", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", m.IdempotencyKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: %v", email.ErrTransient, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))

	switch {
	case resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated:
		var out struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &out); err != nil || out.ID == "" {
			return "", fmt.Errorf("%w: unreadable success response", email.ErrTransient)
		}
		return out.ID, nil
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return "", fmt.Errorf("%w: status %d", email.ErrTransient, resp.StatusCode)
	default:
		// Status only: the body may echo recipient addresses or message text.
		return "", fmt.Errorf("%w: status %d", email.ErrPermanent, resp.StatusCode)
	}
}

var _ email.Sender = (*Client)(nil)

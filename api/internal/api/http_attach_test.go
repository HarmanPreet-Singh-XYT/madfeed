package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func (hn *harness) rawBody(token, method, path string, body []byte) (int, http.Header, []byte) {
	hn.t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/octet-stream")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	hn.h.ServeHTTP(rec, req)
	return rec.Code, rec.Header(), rec.Body.Bytes()
}

func TestFilesInChatOverHTTP(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Shop Support")
	base := "/v1/workspaces/" + ws
	_, st, _ := h.do(h.alice, "PUT", base+"/inbox/settings", map[string]any{"chatEnabled": true, "emailEnabled": false, "origins": []string{"https://shop.example"}})
	pub := "/v1/public/chat/" + st["widgetToken"].(string)
	visitor := "visitor-abcdef0123456789"
	q := "?origin=" + url.QueryEscape("https://shop.example") + "&visitor=" + visitor
	png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 40)...)

	// a visitor adds a picture and sends it with a message
	c, _, body := h.rawBody("", "POST", pub+"/attachments"+q+"&name=receipt.png", png)
	var f map[string]any
	_ = json.Unmarshal(body, &f)
	if c != 201 || f["name"] != "receipt.png" || f["contentType"] != "image/png" {
		t.Fatalf("upload: %d %s", c, body)
	}
	if c, _, _ := h.rawBody("", "POST", pub+"/attachments"+q+"&name=evil.html", []byte("<html><script>1</script></html>")); c != 400 {
		t.Errorf("an HTML file: %d", c)
	}
	if c, _, _ := h.rawBody("", "POST", pub+"/attachments?origin=https%3A%2F%2Fevil.example&visitor="+visitor+"&name=a.png", png); c == 201 {
		t.Errorf("upload from an unlisted site: %d", c)
	}
	if c, _, _ := h.do("", "POST", pub+"/messages", map[string]any{"origin": "https://shop.example", "visitor": visitor, "text": "", "attachmentIds": []string{f["id"].(string)}}); c != 202 {
		t.Fatalf("send with file: %d", c)
	}

	// the team sees it and can only download it
	_, list, _ := h.do(h.alice, "GET", base+"/conversations", nil)
	conv := list["conversations"].([]any)[0].(map[string]any)["id"].(string)
	_, d, _ := h.do(h.alice, "GET", base+"/conversations/"+conv, nil)
	files := d["thread"].([]any)[0].(map[string]any)["files"].([]any)
	if len(files) != 1 {
		t.Fatalf("thread %v", d["thread"])
	}
	code, hdr, data := h.rawBody(h.alice, "GET", base+"/conversations/"+conv+"/attachments/"+f["id"].(string), nil)
	if code != 200 || !bytes.Equal(data, png) || !strings.HasPrefix(hdr.Get("Content-Disposition"), "attachment;") ||
		hdr.Get("X-Content-Type-Options") != "nosniff" || hdr.Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("download: %d %v", code, hdr)
	}
	if c, _, _ := h.rawBody(h.bob, "GET", base+"/conversations/"+conv+"/attachments/"+f["id"].(string), nil); c != 403 && c != 404 {
		t.Errorf("a stranger downloaded it: %d", c)
	}
	if c, _, _ := h.rawBody("", "GET", base+"/conversations/"+conv+"/attachments/"+f["id"].(string), nil); c != 401 {
		t.Errorf("anonymous download: %d", c)
	}

	// the team replies with a file; the visitor downloads it, and only with their own browser id
	c, _, body = h.rawBody(h.alice, "POST", base+"/conversations/"+conv+"/attachments?name=guide.pdf", []byte("%PDF-1.4\n%%EOF"))
	var tf map[string]any
	_ = json.Unmarshal(body, &tf)
	if c != 201 {
		t.Fatalf("team upload: %d %s", c, body)
	}
	if c, r, _ := h.do(h.alice, "POST", base+"/conversations/"+conv+"/reply", map[string]any{"body": "", "seenMessageId": d["lastMessageId"], "attachmentIds": []string{tf["id"].(string)}}); c != 201 {
		t.Fatalf("reply with file: %d %v", c, r)
	}
	code, _, data = h.rawBody("", "GET", pub+"/attachments/"+tf["id"].(string)+q, nil)
	if code != 200 || !strings.HasPrefix(string(data), "%PDF") {
		t.Fatalf("visitor download: %d", code)
	}
	if c, _, _ := h.rawBody("", "GET", pub+"/attachments/"+tf["id"].(string)+"?origin="+url.QueryEscape("https://shop.example")+"&visitor=someone-else-0123456789", nil); c != 404 {
		t.Errorf("another visitor downloaded it: %d", c)
	}
}

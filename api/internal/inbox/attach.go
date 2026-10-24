package inbox

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

const (
	MaxAttachmentBytes   = 5 << 20 // one file
	MaxFilesPerMessage   = 3
	MaxPendingPerSender  = 5         // uploaded, not yet sent
	MaxWorkspaceFileData = 200 << 20 // all files of a workspace
	NoText               = "(sent a file)"
)

// Attachment is a file's description; its bytes are only read by a download.
type Attachment struct {
	ID          uuid.UUID
	MessageID   uuid.UUID
	Name        string
	ContentType string
	Size        int
}

// kinds of file that may be uploaded, by what the bytes really are (the filename and the sender's claimed type
// are not trusted). Nothing a browser would run or render as a page is allowed.
var allowedTypes = map[string]string{
	"image/png": "image/png", "image/jpeg": "image/jpeg", "image/gif": "image/gif", "image/webp": "image/webp",
	"application/pdf": "application/pdf", "text/plain; charset=utf-8": "text/plain",
}

func sniff(data []byte) (string, bool) {
	head := data
	if len(head) > 512 {
		head = head[:512]
	}
	t, ok := allowedTypes[http.DetectContentType(head)]
	// "plain text" that opens like markup (SVG, HTML written without a doctype) is not what a customer means by a text file
	if ok && t == "text/plain" && strings.HasPrefix(strings.TrimSpace(string(head)), "<") {
		return "", false
	}
	return t, ok
}

// fileName keeps a plain, short name: no folders, no control characters, nothing a header could be broken by.
func fileName(in string) string {
	in = strings.ReplaceAll(in, "\\", "/")
	if i := strings.LastIndex(in, "/"); i >= 0 {
		in = in[i+1:]
	}
	var b strings.Builder
	for _, r := range strings.ToValidUTF8(in, "") {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_', r == ' ', r == '(', r == ')':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := strings.TrimLeft(strings.TrimSpace(b.String()), ".")
	if utf8.RuneCountInString(out) > 100 {
		out = string([]rune(out)[:100])
	}
	if out == "" {
		return "file"
	}
	return out
}

func visitorUploader(visitor string) string {
	h := sha256.Sum256([]byte("inbox-visitor|" + visitor))
	return "v:" + hex.EncodeToString(h[:20])
}

func teamUploader(id uuid.UUID) string { return "u:" + id.String() }

func (s *Service) putFile(ctx context.Context, ws uuid.UUID, tn store.Tenant, uploader, name string, r io.Reader) (Attachment, error) {
	data, err := io.ReadAll(io.LimitReader(r, MaxAttachmentBytes+1))
	if err != nil {
		return Attachment{}, ErrInvalid("the file could not be read")
	}
	if len(data) > MaxAttachmentBytes {
		return Attachment{}, ErrInvalid("that file is larger than 5 MB")
	}
	if len(data) == 0 {
		return Attachment{}, ErrInvalid("that file is empty")
	}
	ct, ok := sniff(data)
	if !ok {
		return Attachment{}, ErrInvalid("only pictures (PNG, JPEG, GIF, WebP), PDFs and plain text files can be sent")
	}
	out := Attachment{Name: fileName(name), ContentType: ct, Size: len(data)}
	err = store.WithTenantTx(ctx, s.Pool, tn, func(tx pgx.Tx, _ *dbgen.Queries) error {
		// files that were never sent expire after a day
		if _, err := tx.Exec(ctx, `DELETE FROM conversation_attachment WHERE workspace_id = $1 AND message_id IS NULL AND created_at < now() - interval '1 day'`, ws); err != nil {
			return err
		}
		var pending int
		var total int64
		if err := tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM conversation_attachment WHERE workspace_id = $1 AND uploader = $2 AND message_id IS NULL),
			coalesce((SELECT sum(size) FROM conversation_attachment WHERE workspace_id = $1), 0)`, ws, uploader).Scan(&pending, &total); err != nil {
			return err
		}
		if pending >= MaxPendingPerSender {
			return ErrLimited("send the files you already added first")
		}
		if total+int64(len(data)) > MaxWorkspaceFileData {
			return ErrLimited("file storage for this inbox is full; ask the team to clear old conversations")
		}
		return tx.QueryRow(ctx, `INSERT INTO conversation_attachment (workspace_id, uploader, name, content_type, size, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
			ws, uploader, out.Name, out.ContentType, out.Size, data).Scan(&out.ID)
	})
	return out, err
}

// attach ties uploaded files to a message that is being created. Every file must be this sender's own, not yet
// sent; anything else refuses the whole message.
func attach(ctx context.Context, tx pgx.Tx, ws, conv, msg uuid.UUID, uploader string, ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	seen := map[uuid.UUID]bool{}
	for _, id := range ids {
		seen[id] = true
	}
	if len(seen) > MaxFilesPerMessage {
		return ErrInvalid(fmt.Sprintf("a message can carry up to %d files", MaxFilesPerMessage))
	}
	uniq := make([]uuid.UUID, 0, len(seen))
	for id := range seen {
		uniq = append(uniq, id)
	}
	tag, err := tx.Exec(ctx, `UPDATE conversation_attachment SET conversation_id = $2, message_id = $3 WHERE workspace_id = $1 AND id = ANY($4) AND uploader = $5 AND message_id IS NULL`, ws, conv, msg, uniq, uploader)
	if err != nil {
		return err
	}
	if int(tag.RowsAffected()) != len(uniq) {
		return ErrInvalid("a file you added is no longer available; add it again")
	}
	return nil
}

// filesByMessage describes the files of a conversation's messages.
func filesByMessage(ctx context.Context, q *dbgen.Queries, ws, conv uuid.UUID) (map[uuid.UUID][]Attachment, error) {
	rows, err := q.ListConversationAttachments(ctx, dbgen.ListConversationAttachmentsParams{WorkspaceID: ws, ConversationID: uuid.NullUUID{UUID: conv, Valid: true}})
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID][]Attachment{}
	for _, r := range rows {
		out[r.MessageID.UUID] = append(out[r.MessageID.UUID], Attachment{ID: r.ID, MessageID: r.MessageID.UUID, Name: r.Name, ContentType: r.ContentType, Size: int(r.Size)})
	}
	return out, nil
}

// File is a downloaded attachment.
type File struct {
	Name string
	Size int
	Data []byte
}

// UploadFile (teammates) stores a file to send with the next reply in a website-chat conversation.
func (s *Service) UploadFile(ctx context.Context, t store.Tenant, conv uuid.UUID, name string, r io.Reader) (Attachment, error) {
	if !t.CanWrite() {
		return Attachment{}, store.ErrForbidden
	}
	var channel string
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		err := tx.QueryRow(ctx, `SELECT channel FROM conversation WHERE workspace_id = $1 AND id = $2`, t.WorkspaceID, conv).Scan(&channel)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	})
	if err != nil {
		return Attachment{}, err
	}
	if channel != "chat" {
		return Attachment{}, ErrInvalid("files can be sent in website chat, not by email")
	}
	return s.putFile(ctx, t.WorkspaceID, t, teamUploader(t.UserID), name, r)
}

// OpenFile (teammates, viewers too) reads a file of a conversation.
func (s *Service) OpenFile(ctx context.Context, t store.Tenant, conv, id uuid.UUID) (File, error) {
	var out File
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		a, err := q.GetConversationAttachment(ctx, dbgen.GetConversationAttachmentParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && a.ConversationID.UUID != conv) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out = File{Name: a.Name, Size: int(a.Size), Data: a.Data}
		return nil
	})
	return out, err
}

// ChatUploadFile (visitors, no sign-in) stores a file to send with their next chat message.
func (s *Service) ChatUploadFile(ctx context.Context, token, origin, visitor, addr, name string, r io.Reader) (Attachment, error) {
	if !visitorRe.MatchString(visitor) {
		return Attachment{}, ErrInvalid("this chat could not identify your browser; reload the page and try again")
	}
	ws, _, err := s.verifyWidget(token)
	if err != nil {
		return Attachment{}, ErrNotFound
	}
	var origErr error
	var limited bool
	err = store.WithTenant(ctx, s.Pool, tenantFor(ws), func(q *dbgen.Queries) error {
		if _, _, e := s.widgetSetting(ctx, q, token, origin); e != nil {
			origErr = e
			return nil
		}
		if s.Throttle != nil && !s.Throttle(ctx, "chatfile:"+hexID(ws), addr) {
			limited = true
		}
		return nil
	})
	if err != nil {
		return Attachment{}, err
	}
	if origErr != nil {
		return Attachment{}, origErr
	}
	if limited {
		return Attachment{}, ErrLimited("you are sending files too quickly; wait a moment")
	}
	return s.putFile(ctx, ws, tenantFor(ws), visitorUploader(visitor), name, r)
}

// ChatOpenFile (visitors) reads a file of their own conversation, whoever sent it.
func (s *Service) ChatOpenFile(ctx context.Context, token, origin, visitor string, id uuid.UUID) (File, error) {
	if !visitorRe.MatchString(visitor) {
		return File{}, ErrInvalid("this chat could not identify your browser; reload the page and try again")
	}
	ws, _, err := s.verifyWidget(token)
	if err != nil {
		return File{}, ErrNotFound
	}
	var out File
	var origErr error
	err = store.WithTenant(ctx, s.Pool, tenantFor(ws), func(q *dbgen.Queries) error {
		if _, _, e := s.widgetSetting(ctx, q, token, origin); e != nil {
			origErr = e
			return nil
		}
		c, err := q.GetConversationByVisitor(ctx, dbgen.GetConversationByVisitorParams{WorkspaceID: ws, VisitorKey: pgtype.Text{String: visitor, Valid: true}})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		a, err := q.GetConversationAttachment(ctx, dbgen.GetConversationAttachmentParams{WorkspaceID: ws, ID: id})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (a.ConversationID.UUID != c.ID || a.Direction == "note")) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out = File{Name: a.Name, Size: int(a.Size), Data: a.Data}
		return nil
	})
	if err != nil {
		return File{}, err
	}
	return out, origErr
}

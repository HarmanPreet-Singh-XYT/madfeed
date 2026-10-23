package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// S3 keeps files in any S3-compatible bucket (Supabase Storage, AWS S3, MinIO...).
//
// The upload is resumable and appends piece by piece, which S3 cannot do on one object. So each
// piece is stored as its own small object (<key>.parts/<offset>), the object's size while uploading
// is the sum of its pieces, and the first read (by the transcriber or the player) joins them into
// the final object and removes the pieces. Joining streams through a buffer of about 16 MiB, so
// memory does not grow with the file.
type S3 struct {
	Client *s3.Client
	Bucket string
}

// S3Config describes the bucket. Endpoint is empty for AWS itself.
type S3Config struct {
	Endpoint, Region, Bucket, AccessKeyID, SecretAccessKey string
}

func NewS3(c S3Config) (*S3, error) {
	if c.Bucket == "" || c.Region == "" || c.AccessKeyID == "" || c.SecretAccessKey == "" {
		return nil, errors.New("storage: bucket, region and both access keys are required")
	}
	cfg := aws.Config{
		Region:      c.Region,
		Credentials: credentials.NewStaticCredentialsProvider(c.AccessKeyID, c.SecretAccessKey, ""),
		// Several S3-compatible stores reject the SDK's newer default checksums; ask for them only when required.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.UsePathStyle = true
		if c.Endpoint != "" {
			o.BaseEndpoint = aws.String(c.Endpoint)
		}
	})
	return &S3{Client: client, Bucket: c.Bucket}, nil
}

const (
	partsInfix   = ".parts/"
	maxPiece     = 16 << 20 // a piece larger than this is refused (the API sends at most 8 MiB + 1)
	joinPartSize = 8 << 20
)

func pieceKey(key string, offset int64) string {
	return key + partsInfix + fmt.Sprintf("%020d", offset)
}

type piece struct {
	key    string
	offset int64
	size   int64
}

func isNotFound(err error) bool {
	var nf *types.NotFound
	var nk *types.NoSuchKey
	return errors.As(err, &nf) || errors.As(err, &nk) || strings.Contains(fmt.Sprint(err), "StatusCode: 404")
}

// pieces lists a key's pieces in order.
func (s *S3) pieces(ctx context.Context, key string) ([]piece, error) {
	var out []piece
	p := s3.NewListObjectsV2Paginator(s.Client, &s3.ListObjectsV2Input{Bucket: &s.Bucket, Prefix: aws.String(key + partsInfix)})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, o := range page.Contents {
			off, err := strconv.ParseInt(strings.TrimPrefix(aws.ToString(o.Key), key+partsInfix), 10, 64)
			if err != nil {
				continue
			}
			out = append(out, piece{key: aws.ToString(o.Key), offset: off, size: aws.ToInt64(o.Size)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].offset < out[j].offset })
	return out, nil
}

// contiguous returns the total size, or false if the pieces do not run from 0 without gaps.
func contiguous(ps []piece) (int64, bool) {
	var end int64
	for _, p := range ps {
		if p.offset != end {
			return 0, false
		}
		end += p.size
	}
	return end, true
}

func (s *S3) head(ctx context.Context, key string) (int64, bool, error) {
	h, err := s.Client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &s.Bucket, Key: &key})
	if err != nil {
		if isNotFound(err) {
			return 0, false, nil
		}
		return 0, false, err
	}
	return aws.ToInt64(h.ContentLength), true, nil
}

func (s *S3) Size(ctx context.Context, key string) (int64, error) {
	if err := CheckKey(key); err != nil {
		return 0, err
	}
	if n, ok, err := s.head(ctx, key); err != nil {
		return 0, err
	} else if ok {
		return n, nil
	}
	ps, err := s.pieces(ctx, key)
	if err != nil {
		return 0, err
	}
	if len(ps) == 0 {
		return 0, ErrNotFound
	}
	n, ok := contiguous(ps)
	if !ok {
		return n, ErrBadOffset
	}
	return n, nil
}

func (s *S3) Append(ctx context.Context, key string, offset int64, r io.Reader) (int64, error) {
	if err := CheckKey(key); err != nil {
		return 0, err
	}
	if n, done, herr := s.head(ctx, key); herr != nil {
		return 0, herr
	} else if done { // already joined into the final object: nothing more may be added
		return n, ErrBadOffset
	}
	cur, err := s.Size(ctx, key)
	if errors.Is(err, ErrNotFound) {
		cur, err = 0, nil
	}
	if err != nil {
		return cur, err
	}
	if cur != offset {
		return cur, ErrBadOffset
	}
	data, err := io.ReadAll(io.LimitReader(r, maxPiece+1))
	if err != nil {
		return offset, err
	}
	if len(data) > maxPiece {
		return offset, errors.New("storage: piece is too large")
	}
	if len(data) == 0 {
		return offset, nil
	}
	if _, err := s.Client.PutObject(ctx, &s3.PutObjectInput{Bucket: &s.Bucket, Key: aws.String(pieceKey(key, offset)), Body: bytes.NewReader(data), ContentLength: aws.Int64(int64(len(data)))}); err != nil {
		return offset, err
	}
	return offset + int64(len(data)), nil
}

// Truncate drops whole pieces back to `size`, which must fall on a piece boundary (it always does:
// it is where an earlier, accepted piece ended).
func (s *S3) Truncate(ctx context.Context, key string, size int64) error {
	if err := CheckKey(key); err != nil {
		return err
	}
	ps, err := s.pieces(ctx, key)
	if err != nil {
		return err
	}
	var keep int64
	for _, p := range ps {
		if p.offset >= size {
			continue
		}
		keep = p.offset + p.size
	}
	if keep != size {
		return ErrBadOffset
	}
	for _, p := range ps {
		if p.offset >= size {
			if _, err := s.Client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.Bucket, Key: aws.String(p.key)}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	if err := CheckKey(key); err != nil {
		return err
	}
	ps, err := s.pieces(ctx, key)
	if err != nil {
		return err
	}
	for _, p := range ps {
		if _, err := s.Client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.Bucket, Key: aws.String(p.key)}); err != nil {
			return err
		}
	}
	_, err = s.Client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.Bucket, Key: &key})
	return err
}

func (s *S3) Keys(ctx context.Context) ([]string, error) {
	seen := map[string]bool{}
	var out []string
	p := s3.NewListObjectsV2Paginator(s.Client, &s3.ListObjectsV2Input{Bucket: &s.Bucket})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, o := range page.Contents {
			k, _, _ := strings.Cut(aws.ToString(o.Key), partsInfix)
			if CheckKey(k) == nil && !seen[k] {
				seen[k] = true
				out = append(out, k)
			}
		}
	}
	return out, nil
}

// join builds the final object from the pieces, then removes them. Safe to repeat: if the final
// object already exists nothing is done.
func (s *S3) join(ctx context.Context, key string) error {
	if _, ok, err := s.head(ctx, key); err != nil || ok {
		return err
	}
	ps, err := s.pieces(ctx, key)
	if err != nil {
		return err
	}
	if len(ps) == 0 {
		return ErrNotFound
	}
	if _, ok := contiguous(ps); !ok {
		return ErrBadOffset
	}
	mp, err := s.Client.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{Bucket: &s.Bucket, Key: &key})
	if err != nil {
		return err
	}
	abort := func() {
		_, _ = s.Client.AbortMultipartUpload(context.WithoutCancel(ctx), &s3.AbortMultipartUploadInput{Bucket: &s.Bucket, Key: &key, UploadId: mp.UploadId})
	}
	var done []types.CompletedPart
	var buf bytes.Buffer
	flush := func() error {
		n := int32(len(done) + 1)
		out, err := s.Client.UploadPart(ctx, &s3.UploadPartInput{Bucket: &s.Bucket, Key: &key, UploadId: mp.UploadId, PartNumber: aws.Int32(n), Body: bytes.NewReader(buf.Bytes()), ContentLength: aws.Int64(int64(buf.Len()))})
		if err != nil {
			return err
		}
		done = append(done, types.CompletedPart{ETag: out.ETag, PartNumber: aws.Int32(n)})
		buf.Reset()
		return nil
	}
	for _, p := range ps {
		o, err := s.Client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.Bucket, Key: aws.String(p.key)})
		if err != nil {
			abort()
			return err
		}
		_, err = io.Copy(&buf, o.Body)
		_ = o.Body.Close()
		if err != nil {
			abort()
			return err
		}
		if buf.Len() >= joinPartSize {
			if err := flush(); err != nil {
				abort()
				return err
			}
		}
	}
	if buf.Len() > 0 {
		if err := flush(); err != nil {
			abort()
			return err
		}
	}
	if _, err := s.Client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{Bucket: &s.Bucket, Key: &key, UploadId: mp.UploadId, MultipartUpload: &types.CompletedMultipartUpload{Parts: done}}); err != nil {
		abort()
		return err
	}
	for _, p := range ps {
		_, _ = s.Client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.Bucket, Key: aws.String(p.key)})
	}
	return nil
}

func (s *S3) Open(ctx context.Context, key string) (Object, error) {
	if err := CheckKey(key); err != nil {
		return nil, err
	}
	if err := s.join(ctx, key); err != nil {
		return nil, err
	}
	n, ok, err := s.head(ctx, key)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	return &s3Object{s: s, ctx: ctx, key: key, size: n}, nil
}

// s3Object reads an object in ranges with a small read-ahead, so it can be seeked (the player
// jumps around) without downloading the whole file.
type s3Object struct {
	s        *S3
	ctx      context.Context
	key      string
	size     int64
	pos      int64
	buf      []byte
	bufStart int64
}

const readAhead = 4 << 20

func (o *s3Object) Size() int64  { return o.size }
func (o *s3Object) Close() error { return nil }

func (o *s3Object) Read(p []byte) (int, error) {
	if o.pos >= o.size {
		return 0, io.EOF
	}
	if o.pos < o.bufStart || o.pos >= o.bufStart+int64(len(o.buf)) {
		end := min(o.pos+readAhead, o.size) - 1
		out, err := o.s.Client.GetObject(o.ctx, &s3.GetObjectInput{Bucket: &o.s.Bucket, Key: &o.key, Range: aws.String(fmt.Sprintf("bytes=%d-%d", o.pos, end))})
		if err != nil {
			return 0, err
		}
		data, err := io.ReadAll(out.Body)
		_ = out.Body.Close()
		if err != nil {
			return 0, err
		}
		o.buf, o.bufStart = data, o.pos
	}
	n := copy(p, o.buf[o.pos-o.bufStart:])
	o.pos += int64(n)
	return n, nil
}

func (o *s3Object) Seek(offset int64, whence int) (int64, error) {
	var abs int64
	switch whence {
	case io.SeekStart:
		abs = offset
	case io.SeekCurrent:
		abs = o.pos + offset
	case io.SeekEnd:
		abs = o.size + offset
	default:
		return 0, errors.New("storage: bad whence")
	}
	if abs < 0 {
		return 0, errors.New("storage: negative position")
	}
	o.pos = abs
	return abs, nil
}

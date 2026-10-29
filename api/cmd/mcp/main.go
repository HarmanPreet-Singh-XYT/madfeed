// Command mcp runs the feedback MCP server over standard input and output, for desktop AI
// assistants. It needs two settings: FEEDBACK_API_URL (the address of the API) and
// FEEDBACK_API_KEY (a read-only key made in Settings > API keys).
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"product/api/internal/mcpserver"
)

func main() {
	base, key := os.Getenv("FEEDBACK_API_URL"), os.Getenv("FEEDBACK_API_KEY")
	if base == "" || !strings.HasPrefix(key, "fk_") {
		fmt.Fprintln(os.Stderr, "set FEEDBACK_API_URL and FEEDBACK_API_KEY (a key that starts with fk_)")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// Quotes that look like instructions aimed at an AI are withheld unless this is set (not recommended).
	show := os.Getenv("FEEDBACK_MCP_SHOW_FLAGGED") == "1"
	s := mcpserver.NewServer(&mcpserver.Client{BaseURL: base, Key: key, ShowFlagged: show}, "1")
	if err := s.Run(ctx, &mcp.StdioTransport{}); err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, "mcp server stopped:", err)
		os.Exit(1)
	}
}

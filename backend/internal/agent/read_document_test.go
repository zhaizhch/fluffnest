package agent

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fluffnest/deskpet/backend/internal/types"
)

func TestToolReadDocumentSandbox(t *testing.T) {
	dir := t.TempDir()
	media := filepath.Join(dir, "wechat-media")
	if err := os.MkdirAll(media, 0o755); err != nil {
		t.Fatal(err)
	}
	okPath := filepath.Join(media, "note.txt")
	if err := os.WriteFile(okPath, []byte("绒窝附件内容 ABC"), 0o644); err != nil {
		t.Fatal(err)
	}
	secret := filepath.Join(dir, "secret.txt")
	_ = os.WriteFile(secret, []byte("should not read"), 0o644)

	deps := ToolDeps{
		Attachments: []types.ImAttachment{{Path: okPath, Name: "note.txt"}},
		MediaRoot:   media,
	}
	out := toolReadDocument(context.Background(), deps, map[string]any{})
	if !strings.Contains(out, "绒窝附件内容") {
		t.Fatalf("expected extract, got %q", out)
	}

	denied := toolReadDocument(context.Background(), deps, map[string]any{"path": secret})
	if !strings.Contains(denied, "无权") {
		t.Fatalf("expected sandbox deny, got %q", denied)
	}
}

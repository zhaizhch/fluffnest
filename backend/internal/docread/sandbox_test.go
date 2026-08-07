package docread

import (
	"path/filepath"
	"testing"
)

func TestAllowPath(t *testing.T) {
	dir := t.TempDir()
	media := filepath.Join(dir, "wechat-media", "a.pdf")
	outside := filepath.Join(dir, "secret.txt")

	allowed := []string{media}
	if err := AllowPath(media, allowed, filepath.Join(dir, "wechat-media")); err != nil {
		t.Fatalf("expected allow: %v", err)
	}
	if err := AllowPath(outside, allowed, filepath.Join(dir, "wechat-media")); err == nil {
		t.Fatal("expected deny outside")
	}
	if err := AllowPath(filepath.Join(dir, "wechat-media", "b.pdf"), nil, filepath.Join(dir, "wechat-media")); err != nil {
		t.Fatalf("media dir should allow: %v", err)
	}
	if err := AllowPath("../etc/passwd", allowed, filepath.Join(dir, "wechat-media")); err == nil {
		t.Fatal("expected deny traversal")
	}
}

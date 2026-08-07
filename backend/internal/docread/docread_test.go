package docread

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadPlainAndTruncate(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "note.txt")
	body := strings.Repeat("你好世界", 100) // 400 runes
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	r, err := Extract(path, 50)
	if err != nil {
		t.Fatal(err)
	}
	if r.Format != "txt" {
		t.Fatalf("format=%s", r.Format)
	}
	if !r.Truncated {
		t.Fatal("expected truncation")
	}
	if r.Chars != 400 {
		t.Fatalf("chars=%d", r.Chars)
	}
	if !strings.HasSuffix(r.Text, "…") {
		t.Fatalf("text=%q", r.Text)
	}
}

func TestReadDocx(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hello.docx")
	if err := writeMinimalDocx(path, "绒窝文档测试 Hello"); err != nil {
		t.Fatal(err)
	}
	r, err := Extract(path, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if r.Format != "docx" {
		t.Fatalf("format=%s", r.Format)
	}
	if !strings.Contains(r.Text, "绒窝文档测试") {
		t.Fatalf("missing text: %q", r.Text)
	}
	if !strings.Contains(r.Text, "Hello") {
		t.Fatalf("missing Hello: %q", r.Text)
	}
}

func TestUnsupported(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "x.bin")
	_ = os.WriteFile(path, []byte("abc"), 0o644)
	_, err := Extract(path, 100)
	if err == nil {
		t.Fatal("expected error")
	}
}

func writeMinimalDocx(path, text string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	contentTypes := `[Content_Types].xml`
	w, err := zw.Create(contentTypes)
	if err != nil {
		return err
	}
	_, _ = w.Write([]byte(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`))

	w, err = zw.Create("word/document.xml")
	if err != nil {
		return err
	}
	xml := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>` + text + `</w:t></w:r></w:p></w:body>
</w:document>`
	_, _ = w.Write([]byte(xml))
	return zw.Close()
}

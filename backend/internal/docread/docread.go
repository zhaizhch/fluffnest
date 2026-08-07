// Package docread extracts plain text from common document formats.
package docread

import (
	"archive/zip"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
)

const DefaultMaxRunes = 10000

// Result is extracted document text plus light metadata.
type Result struct {
	Name     string
	Format   string
	Chars    int
	Pages    int
	Truncated bool
	Text     string
}

// Extract reads path and returns truncated plain text.
func Extract(path string, maxRunes int) (Result, error) {
	if maxRunes <= 0 {
		maxRunes = DefaultMaxRunes
	}
	name := filepath.Base(path)
	ext := strings.ToLower(filepath.Ext(path))
	var (
		text   string
		pages  int
		format string
		err    error
	)
	switch ext {
	case ".txt", ".md", ".markdown", ".csv", ".log", ".json", ".xml", ".html", ".htm":
		format = strings.TrimPrefix(ext, ".")
		text, err = readPlain(path)
	case ".docx":
		format = "docx"
		text, err = readDocx(path)
	case ".pdf":
		format = "pdf"
		text, pages, err = readPDF(path)
	case ".doc":
		return Result{Name: name, Format: "doc"}, fmt.Errorf("不支持旧版 .doc，请转成 .docx 或 PDF")
	default:
		return Result{Name: name, Format: ext}, fmt.Errorf("不支持的格式 %s（支持 pdf / docx / txt / md）", ext)
	}
	if err != nil {
		return Result{Name: name, Format: format}, err
	}
	text = strings.TrimSpace(normalizeWS(text))
	if text == "" {
		return Result{Name: name, Format: format, Pages: pages}, fmt.Errorf("未能从文档中抽出文字（可能是扫描件或加密文件）")
	}
	truncated, cut := truncateRunes(text, maxRunes)
	return Result{
		Name:      name,
		Format:    format,
		Chars:     utf8.RuneCountInString(text),
		Pages:     pages,
		Truncated: cut,
		Text:      truncated,
	}, nil
}

// FormatResult renders a tool-friendly summary.
func FormatResult(r Result) string {
	var b strings.Builder
	fmt.Fprintf(&b, "文档：%s\n格式：%s\n字数：%d", r.Name, r.Format, r.Chars)
	if r.Pages > 0 {
		fmt.Fprintf(&b, "\n页数：%d", r.Pages)
	}
	if r.Truncated {
		b.WriteString("\n（正文已截断）")
	}
	b.WriteString("\n\n")
	b.WriteString(r.Text)
	return b.String()
}

func readPlain(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if utf8.Valid(raw) {
		return string(raw), nil
	}
	return string(bytes.ToValidUTF8(raw, []byte("�"))), nil
}

func readDocx(path string) (string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", fmt.Errorf("打开 docx 失败: %w", err)
	}
	defer zr.Close()

	var xmlData []byte
	for _, f := range zr.File {
		if f.Name == "word/document.xml" {
			rc, err := f.Open()
			if err != nil {
				return "", err
			}
			buf := &bytes.Buffer{}
			_, err = buf.ReadFrom(rc)
			_ = rc.Close()
			if err != nil {
				return "", err
			}
			xmlData = buf.Bytes()
			break
		}
	}
	if xmlData == nil {
		return "", fmt.Errorf("docx 缺少 word/document.xml")
	}
	return extractDocxXML(xmlData), nil
}

// extractDocxXML pulls text nodes and inserts newlines on paragraph breaks.
func extractDocxXML(xmlData []byte) string {
	var b strings.Builder
	data := string(xmlData)
	i := 0
	for i < len(data) {
		// Paragraph break
		if strings.HasPrefix(data[i:], "</w:p>") || strings.HasPrefix(data[i:], "</w:p ") {
			b.WriteByte('\n')
			i++
			continue
		}
		if strings.HasPrefix(data[i:], "<w:t") {
			gt := strings.IndexByte(data[i:], '>')
			if gt < 0 {
				break
			}
			start := i + gt + 1
			end := strings.Index(data[start:], "</w:t>")
			if end < 0 {
				break
			}
			b.WriteString(data[start : start+end])
			i = start + end + len("</w:t>")
			continue
		}
		i++
	}
	return b.String()
}

func readPDF(path string) (string, int, error) {
	f, r, err := pdf.Open(path)
	if err != nil {
		return "", 0, fmt.Errorf("打开 PDF 失败: %w", err)
	}
	defer f.Close()
	pages := r.NumPage()
	var b strings.Builder
	for i := 1; i <= pages; i++ {
		p := r.Page(i)
		if p.V.IsNull() {
			continue
		}
		text, err := p.GetPlainText(nil)
		if err != nil {
			continue
		}
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		fmt.Fprintf(&b, "--- 第 %d 页 ---\n%s", i, text)
	}
	return b.String(), pages, nil
}

func normalizeWS(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	for strings.Contains(s, "\n\n\n") {
		s = strings.ReplaceAll(s, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(s)
}

func truncateRunes(s string, max int) (string, bool) {
	if max <= 0 {
		return s, false
	}
	r := []rune(s)
	if len(r) <= max {
		return s, false
	}
	return string(r[:max]) + "…", true
}

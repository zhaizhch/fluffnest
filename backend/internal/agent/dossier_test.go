package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOwnerAndSelfDossierRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mem.json")
	m, err := OpenMemory(path)
	if err != nil {
		t.Fatal(err)
	}
	peer := "owner@im.wechat"
	if err := m.OwnerUpdateField(peer, "identity", "nickname", "主人"); err != nil {
		t.Fatal(err)
	}
	if err := m.OwnerUpdateField(peer, "preferences", "tone", "简洁认真，少卖萌"); err != nil {
		t.Fatal(err)
	}
	if err := m.OwnerAppendNote(peer, "喜欢星露谷物语"); err != nil {
		t.Fatal(err)
	}
	if err := m.SelfUpdateField("masterFit", "likes", "直接给结论"); err != nil {
		t.Fatal(err)
	}
	if err := m.SelfAppend("lesson", "搜游戏新料要用英文别名"); err != nil {
		t.Fatal(err)
	}

	// Reload from disk
	m2, err := OpenMemory(path)
	if err != nil {
		t.Fatal(err)
	}
	o := m2.OwnerGet(peer)
	if o.Identity["nickname"] != "主人" {
		t.Fatalf("nickname=%q", o.Identity["nickname"])
	}
	if o.Preferences["tone"] == "" {
		t.Fatal("missing tone")
	}
	if len(o.Notes) != 1 {
		t.Fatalf("notes=%v", o.Notes)
	}
	s := m2.SelfGet()
	if s.MasterFit["likes"] == "" {
		t.Fatal("missing masterFit")
	}
	if len(s.Lessons) != 1 {
		t.Fatalf("lessons=%v", s.Lessons)
	}

	brief := m2.DossierBrief(peer)
	if !strings.Contains(brief, "主人") {
		t.Fatalf("brief missing nickname: %s", brief)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}

func TestCatalogHasDossierAssets(t *testing.T) {
	cat, err := LoadCatalog()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"owner-dossier", "self-growth"} {
		if _, ok := cat.FindSkill(name); !ok {
			t.Fatalf("missing skill %s", name)
		}
	}
	found := false
	for _, r := range cat.Rules {
		if r.Name == "dossiers" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing rule dossiers")
	}
}

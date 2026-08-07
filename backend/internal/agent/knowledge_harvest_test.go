package agent

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestExtractKnowledgeHitsFavorites(t *testing.T) {
	cases := []struct {
		in   string
		want string
		sec  string
	}{
		{"我最喜欢的人是周杰伦", "周杰伦", "relationships"},
		{"我最喜欢星露谷", "星露谷", "preferences"},
		{"黑田朝日是我的最爱", "黑田朝日", ""},
		{"我超喜欢看球", "看球", "preferences"},
		{"我爱玩原神", "原神", "lifestyle"},
		{"我不喜欢加班", "加班", "preferences"},
		{"我女朋友叫小美", "小美", "relationships"},
		{"以后叫我阿杰", "阿杰", "identity"},
	}
	for _, c := range cases {
		hits := extractKnowledgeHits(c.in)
		if len(hits) == 0 {
			t.Fatalf("%q: no hits", c.in)
		}
		ok := false
		for _, h := range hits {
			if c.sec != "" && h.Section != c.sec {
				continue
			}
			if strings.Contains(h.Value, c.want) {
				ok = true
				break
			}
		}
		if !ok {
			t.Fatalf("%q: want %q in %#v", c.in, c.want, hits)
		}
	}
}

func TestExtractPersonalProfileFacts(t *testing.T) {
	cases := []struct {
		in, wantSec, wantKey, wantVal string
	}{
		{"我家在北京", "identity", "home_city", "北京"},
		{"我在腾讯上班", "work", "company", "腾讯"},
		{"我是后端工程师", "work", "role", "后端工程师"},
		{"我一般23点睡觉", "lifestyle", "sleep_time", "23点"},
		{"别跟我提前任", "boundaries", "no_go", "前任"},
		{"我最近打算考研", "goals", "focus", "考研"},
		{"我的猫叫馒头", "relationships", "猫", "馒头"},
		{"我对花生过敏", "lifestyle", "allergies", "花生"},
		{"回复简洁一点", "preferences", "tone", "简洁"},
	}
	for _, c := range cases {
		hits := extractKnowledgeHits(c.in)
		ok := false
		for _, h := range hits {
			if h.Section == c.wantSec && h.Key == c.wantKey && strings.Contains(h.Value, c.wantVal) {
				ok = true
				break
			}
		}
		if !ok {
			t.Fatalf("%q: want %s.%s=%s in %#v", c.in, c.wantSec, c.wantKey, c.wantVal, hits)
		}
	}
}

func TestHarvestOwnerKnowledgePersists(t *testing.T) {
	m, err := OpenMemory(filepath.Join(t.TempDir(), "mem.json"))
	if err != nil {
		t.Fatal(err)
	}
	peer := "wx_fav_test"
	n := m.HarvestOwnerKnowledge(peer, "我最喜欢的人是梅西，还爱玩星露谷，我家在上海")
	if n == 0 {
		t.Fatal("expected harvest writes")
	}
	d := m.OwnerGet(peer)
	if !strings.Contains(d.Relationships["favorite_people"], "梅西") {
		t.Fatalf("people=%v", d.Relationships)
	}
	if d.Identity["home_city"] != "上海" {
		t.Fatalf("city=%v", d.Identity)
	}
	fav := d.Preferences["favorites"] + d.Lifestyle["favorite_games"] + d.Lifestyle["hobbies"]
	if !strings.Contains(fav, "星露谷") {
		t.Fatalf("favorites missing 星露谷: prefs=%v life=%v", d.Preferences, d.Lifestyle)
	}
	brief := m.DossierBrief(peer)
	if !strings.Contains(brief, "梅西") && !strings.Contains(brief, "星露谷") {
		t.Fatalf("brief should surface favorites: %s", brief)
	}
	if !strings.Contains(brief, "上海") {
		t.Fatalf("brief should surface city: %s", brief)
	}
}

func TestMergeUniqueList(t *testing.T) {
	got := mergeUniqueList("周杰伦、梅西", "梅西、哈兰德", 8)
	if !strings.Contains(got, "哈兰德") || strings.Count(got, "梅西") != 1 {
		t.Fatalf("got %q", got)
	}
}

func TestHasPersonalFactSignal(t *testing.T) {
	if !hasPersonalFactSignal("我最喜欢周杰伦") {
		t.Fatal("expected preference signal")
	}
	if !hasPersonalFactSignal("我家在杭州") {
		t.Fatal("expected city signal")
	}
	if hasPersonalFactSignal("哈哈哈摸摸") {
		t.Fatal("chitchat should not signal")
	}
}

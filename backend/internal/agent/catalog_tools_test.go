package agent

import (
	"testing"

	"github.com/fluffnest/deskpet/backend/internal/types"
)

func TestEvalArithmetic(t *testing.T) {
	cases := map[string]float64{
		"1+2*3":         7,
		"(120+30)*0.85": 127.5,
		"10%3":          1,
		"-5+2":          -3,
	}
	for expr, want := range cases {
		got, err := evalArithmetic(expr)
		if err != nil {
			t.Fatalf("%s: %v", expr, err)
		}
		if got != want {
			t.Fatalf("%s: got %v want %v", expr, got, want)
		}
	}
}

func TestLoadCatalogHasNewAssets(t *testing.T) {
	cat, err := LoadCatalog()
	if err != nil {
		t.Fatal(err)
	}
	needRules := []string{"core", "wechat", "safety", "tool-discipline", "persona", "dossiers"}
	for _, name := range needRules {
		found := false
		for _, r := range cat.Rules {
			if r.Name == name {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing rule %s", name)
		}
	}
	needSkills := []string{"news-digest", "entertainment", "planner", "clarify", "lingua", "documents", "owner-dossier", "self-growth"}
	for _, name := range needSkills {
		if _, ok := cat.FindSkill(name); !ok {
			t.Fatalf("missing skill %s", name)
		}
	}
	matched := cat.MatchSkills("讲个笑话")
	if len(matched) == 0 {
		t.Fatal("expected entertainment match for 讲个笑话")
	}
	docs := cat.MatchSkills("帮我总结这个PDF文件")
	foundDoc := false
	for _, sk := range docs {
		if sk.Name == "documents" {
			foundDoc = true
		}
	}
	if !foundDoc {
		t.Fatalf("expected documents skill, got %#v", docs)
	}
}

func TestRouteSkillsFollowUp(t *testing.T) {
	cat, err := LoadCatalog()
	if err != nil {
		t.Fatal(err)
	}
	routed := cat.RouteSkills("再来一个", nil, []string{"entertainment"})
	if len(routed) == 0 || routed[0].Name != "entertainment" {
		t.Fatalf("expected entertainment continuity, got %#v", routed)
	}

	hist := []types.ChatMessage{{Role: "user", Content: "[微信] 帮我翻译成英文 Hello"}}
	routed2 := cat.RouteSkills("继续", hist, nil)
	if len(routed2) == 0 || routed2[0].Name != "lingua" {
		t.Fatalf("expected lingua from history, got %#v", routed2)
	}
}

func TestRouteSkillsDirectLingua(t *testing.T) {
	cat, err := LoadCatalog()
	if err != nil {
		t.Fatal(err)
	}
	routed := cat.RouteSkills("把这段总结一下：人工智能正在改变软件工程", nil, nil)
	found := false
	for _, sk := range routed {
		if sk.Name == "lingua" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected lingua, got %#v", routed)
	}
}

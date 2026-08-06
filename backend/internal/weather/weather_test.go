package weather

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/cache"
)

func TestLookupCityCode(t *testing.T) {
	code, _, ok := lookupCityCode("北京市")
	if !ok || code != "101010100" {
		t.Fatalf("北京 got %s ok=%v", code, ok)
	}
	code, _, ok = lookupCityCode("南皮")
	if !ok || code != "101090707" {
		t.Fatalf("南皮 got %s ok=%v", code, ok)
	}
}

func TestFetchDayLive(t *testing.T) {
	svc := New(&http.Client{Timeout: 10 * time.Second}, cache.New())
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	snap, err := svc.FetchDay(ctx, "北京", 0)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Label == "" || snap.Condition == "" || snap.TempC == 0 {
		t.Fatalf("empty snap: %+v", snap)
	}
	t.Logf("%s %s %.1f℃ (%.0f~%.0f)", snap.Label, snap.Condition, snap.TempC, snap.TempMin, snap.TempMax)

	tom, err := svc.FetchDay(ctx, "北京", 1)
	if err != nil {
		t.Fatal(err)
	}
	if !tom.DailyOnly || tom.TempMax == 0 {
		t.Fatalf("tomorrow snap: %+v", tom)
	}
	t.Logf("tomorrow %s %.0f~%.0f℃", tom.Condition, tom.TempMin, tom.TempMax)
}

func TestParseTempC(t *testing.T) {
	if parseTempC("高温 37℃") != 37 {
		t.Fatal(parseTempC("高温 37℃"))
	}
	if parseTempC("低温 28℃") != 28 {
		t.Fatal(parseTempC("低温 28℃"))
	}
}

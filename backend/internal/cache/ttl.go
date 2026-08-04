package cache

import (
	"sync"
	"time"
)

// TTL is a tiny concurrent string cache with expiration.
type TTL struct {
	mu    sync.RWMutex
	items map[string]entry
}

type entry struct {
	value string
	exp   time.Time
}

func New() *TTL {
	return &TTL{items: make(map[string]entry)}
}

func (c *TTL) Get(key string) (string, bool) {
	c.mu.RLock()
	e, ok := c.items[key]
	c.mu.RUnlock()
	if !ok || time.Now().After(e.exp) {
		if ok {
			c.mu.Lock()
			delete(c.items, key)
			c.mu.Unlock()
		}
		return "", false
	}
	return e.value, true
}

func (c *TTL) Set(key, value string, ttl time.Duration) {
	c.mu.Lock()
	c.items[key] = entry{value: value, exp: time.Now().Add(ttl)}
	c.mu.Unlock()
}

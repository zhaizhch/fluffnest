package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/fluffnest/deskpet/backend/internal/server"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:0", "listen address (host:port); port 0 = ephemeral")
	flag.Parse()

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatalf("listen: %v", err)
	}

	// First line on stdout is the ready handshake for the Tauri host.
	fmt.Printf("FLUFFNEST_AI_READY %s\n", ln.Addr().String())
	_ = os.Stdout.Sync()

	srv := server.New()
	go func() {
		if err := srv.Serve(ln); err != nil {
			log.Printf("serve stopped: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	_ = ln.Close()
}

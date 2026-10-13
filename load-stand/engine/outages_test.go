package engine

import (
	"math/rand"
	"testing"
	"time"
)

func TestOutageDelayStaysInsideRange(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	for i := 0; i < 40; i++ {
		delay := outageDelay(rng, 15, 40)
		if delay < 15*time.Second || delay > 40*time.Second {
			t.Fatalf("delay %s outside 15-40s", delay)
		}
	}
	if outageDelay(rng, 10, 10) != 10*time.Second {
		t.Fatal("expected a fixed delay when the range is a single value")
	}
}

func TestValidateOutages(t *testing.T) {
	valid := TestConfig{
		OutageServers: []string{"file-farm-server-1", "file-farm-server-4"},
		OutageMinSec:  15,
		OutageMaxSec:  40,
		Duration:      180,
	}
	if err := validateOutages(valid); err != nil {
		t.Fatal(err)
	}

	openEnded := valid
	openEnded.Duration = 0
	if err := validateOutages(openEnded); err != nil {
		t.Fatal(err)
	}

	cases := []TestConfig{
		{OutageServers: []string{"file-farm-envoy"}, OutageMinSec: 15, OutageMaxSec: 40, Duration: 180},
		{OutageServers: []string{"file-farm-server-1", "file-farm-server-1"}, OutageMinSec: 15, OutageMaxSec: 40, Duration: 180},
		{OutageServers: []string{"file-farm-server-1"}, OutageMinSec: 4, OutageMaxSec: 40, Duration: 180},
		{OutageServers: []string{"file-farm-server-1"}, OutageMinSec: 30, OutageMaxSec: 10, Duration: 180},
		{OutageServers: []string{"file-farm-server-1"}, OutageMinSec: 20, OutageMaxSec: 30, Duration: 20},
	}
	for _, config := range cases {
		if err := validateOutages(config); err == nil {
			t.Fatalf("expected outage config %+v to be rejected", config)
		}
	}
}

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

func TestValidateOutagePlan(t *testing.T) {
	valid := TestConfig{
		Duration: 600,
		OutagePlan: []PlannedOutage{
			{Server: "file-farm-server-1", StopAtSec: 180, StartAtSec: 360},
			{Server: "file-farm-server-3", StopAtSec: 300, StartAtSec: 480},
			{Server: "file-farm-server-1", StopAtSec: 400, StartAtSec: 450},
		},
	}
	if err := validateOutagePlan(valid); err != nil {
		t.Fatal(err)
	}
	if err := validateOutagePlan(TestConfig{}); err != nil {
		t.Fatal(err)
	}

	bad := []TestConfig{
		{Duration: 600, OutagePlan: []PlannedOutage{{Server: "file-farm-envoy", StopAtSec: 60, StartAtSec: 120}}},
		{Duration: 600, OutagePlan: []PlannedOutage{{Server: "file-farm-server-1", StopAtSec: 2, StartAtSec: 120}}},
		{Duration: 600, OutagePlan: []PlannedOutage{{Server: "file-farm-server-1", StopAtSec: 120, StartAtSec: 120}}},
		{Duration: 600, OutagePlan: []PlannedOutage{{Server: "file-farm-server-1", StopAtSec: 600, StartAtSec: 700}}},
		{Duration: 600, OutagePlan: []PlannedOutage{
			{Server: "file-farm-server-1", StopAtSec: 100, StartAtSec: 300},
			{Server: "file-farm-server-1", StopAtSec: 200, StartAtSec: 400},
		}},
		{Duration: 600, StopServer: "file-farm-server-2", StopAfterSec: 60,
			OutagePlan: []PlannedOutage{{Server: "file-farm-server-1", StopAtSec: 60, StartAtSec: 120}}},
	}
	for _, config := range bad {
		if err := validateOutagePlan(config); err == nil {
			t.Fatalf("expected plan %+v to be rejected", config.OutagePlan)
		}
	}
}

func TestOutageEventsAreOrderedInTime(t *testing.T) {
	events := outageEvents([]PlannedOutage{
		{Server: "file-farm-server-1", StopAtSec: 180, StartAtSec: 360},
		{Server: "file-farm-server-3", StopAtSec: 300, StartAtSec: 480},
	})
	want := []outageEvent{
		{180, "file-farm-server-1", true},
		{300, "file-farm-server-3", true},
		{360, "file-farm-server-1", false},
		{480, "file-farm-server-3", false},
	}
	if len(events) != len(want) {
		t.Fatalf("got %d events, want %d", len(events), len(want))
	}
	for index := range want {
		if events[index] != want[index] {
			t.Fatalf("event %d = %+v, want %+v", index, events[index], want[index])
		}
	}

	// A server that comes back and goes down again in the same second is started first.
	same := outageEvents([]PlannedOutage{
		{Server: "file-farm-server-2", StopAtSec: 60, StartAtSec: 120},
		{Server: "file-farm-server-2", StopAtSec: 120, StartAtSec: 180},
	})
	if same[1].stop || !same[2].stop || same[1].atSec != 120 || same[2].atSec != 120 {
		t.Fatalf("expected start before stop at 120s, got %+v", same)
	}
}

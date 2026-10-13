package engine

import "testing"

func TestAllowedServerName(t *testing.T) {
	if !allowedServerName("file-farm-server-1") || !allowedServerName("file-farm-server-4") {
		t.Fatal("expected the four file-farm servers to be allowed")
	}
	if allowedServerName("file-farm-server-5") || allowedServerName("file-farm-envoy") || allowedServerName("") {
		t.Fatal("unexpected server name was allowed")
	}
}

func TestApplyContainerPowerMarksStoppedServerDown(t *testing.T) {
	servers := []ServerStatus{{Name: "file-farm-server-1", Status: "up"}}
	applyContainerPower(servers, map[string]bool{"file-farm-server-1": false})
	if servers[0].Running || servers[0].Status != "down" {
		t.Fatalf("stopped container should be offline, got %+v", servers[0])
	}
}

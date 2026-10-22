package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const dockerAPIPrefix = "/v1.41"

// dockerClient talks to the local engine over the Unix socket.
// Only the four file-farm server containers can be changed.
type dockerClient struct {
	http *http.Client
}

func newDockerClient(socketPath string) *dockerClient {
	return &dockerClient{
		http: &http.Client{
			Timeout: 20 * time.Second,
			Transport: &http.Transport{
				DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
					return (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
				},
			},
		},
	}
}

func allowedServerName(name string) bool {
	switch name {
	case "file-farm-server-1", "file-farm-server-2", "file-farm-server-3", "file-farm-server-4":
		return true
	default:
		return false
	}
}

func (c *dockerClient) setPower(ctx context.Context, name, action string) error {
	if !allowedServerName(name) {
		return fmt.Errorf("unknown server %q", name)
	}

	var path string
	switch action {
	case "start":
		path = fmt.Sprintf("%s/containers/%s/start", dockerAPIPrefix, name)
	case "stop":
		path = fmt.Sprintf("%s/containers/%s/stop?t=10", dockerAPIPrefix, name)
	default:
		return fmt.Errorf("action must be start or stop")
	}

	response, err := c.do(ctx, http.MethodPost, path)
	if err != nil {
		return fmt.Errorf("docker is not reachable: %w", err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))

	// 304 means the container is already in the requested state.
	if response.StatusCode == http.StatusNoContent || response.StatusCode == http.StatusNotModified {
		return nil
	}
	return fmt.Errorf("docker %s %s failed: %s", action, name, strings.TrimSpace(string(body)))
}

func (c *dockerClient) running(ctx context.Context) (map[string]bool, error) {
	states := make(map[string]bool, serverCount)
	for i := 1; i <= serverCount; i++ {
		name := fmt.Sprintf("file-farm-server-%d", i)
		on, err := c.isRunning(ctx, name)
		if err != nil {
			return nil, err
		}
		states[name] = on
	}
	return states, nil
}

func (c *dockerClient) isRunning(ctx context.Context, name string) (bool, error) {
	response, err := c.do(ctx, http.MethodGet, fmt.Sprintf("%s/containers/%s/json", dockerAPIPrefix, name))
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
		return false, fmt.Errorf("docker inspect %s: %s", name, strings.TrimSpace(string(body)))
	}

	var payload struct {
		State struct {
			Running bool `json:"Running"`
		} `json:"State"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return false, err
	}
	return payload.State.Running, nil
}

func (c *dockerClient) do(ctx context.Context, method, path string) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, "http://docker"+path, nil)
	if err != nil {
		return nil, err
	}
	return c.http.Do(request)
}

// fetchServerStatuses reads the servers from Prometheus and then corrects them with
// the state of the containers. Docker knows about a stop at once, Prometheus only after
// a failed scrape, and the live view and the saved series must show the same thing.
func (e *Engine) fetchServerStatuses() ([]ServerStatus, error) {
	servers, err := FetchServerStatuses(e.prometheusURL)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if states, dockerErr := e.docker.running(ctx); dockerErr == nil {
		applyContainerPower(servers, states)
	} else {
		applyContainerPower(servers, nil)
	}
	return servers, err
}

func applyContainerPower(servers []ServerStatus, states map[string]bool) {
	for i := range servers {
		running, ok := states[servers[i].Name]
		if !ok {
			servers[i].Running = servers[i].Status == "up"
			continue
		}
		servers[i].Running = running
		if !running {
			servers[i].Status = "down"
			clearDownServer(&servers[i])
		}
	}
}

// clearDownServer drops what a stopped server still reports. Prometheus averages RPS
// and errors over 15 s, so without this the charts show a tail of traffic that no longer
// exists for a quarter of a minute after the server went down.
func clearDownServer(server *ServerStatus) {
	server.EDS = 0
	server.RPS = 0
	server.Error = 0
	server.CPU = 0
}

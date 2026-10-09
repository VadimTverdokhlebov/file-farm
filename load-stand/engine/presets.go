package engine

const (
	UploadFileRPC  = "/filefarm.file.FileService/UploadFile"
	DownloadFileRPC = "/filefarm.file.FileService/DownloadFile"
	CompressFileRPC = "/filefarm.file.FileService/CompressFile"
	CreateUserRPC  = "/filefarm.user.UserService/CreateUser"
	GetUserRPC     = "/filefarm.user.UserService/GetUser"
)

type Preset struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Endpoints   []string `json:"endpoints"`
	FileSizeKB  int      `json:"fileSizeKb"`
	WarmupFiles int      `json:"warmupFiles"`
}

var presets = []Preset{
	{
		ID:          "upload-heavy",
		Name:        "Upload heavy",
		Description: "Only UploadFile with large payloads. Loads CPU, RAM and disk writes — good for comparing LB under write-heavy traffic.",
		Endpoints:   []string{UploadFileRPC},
		FileSizeKB:  512,
		WarmupFiles: 0,
	},
	{
		ID:          "download-heavy",
		Name:        "Download heavy",
		Description: "Pre-uploads files, then only DownloadFile. Loads disk reads and network — useful when backends already have data.",
		Endpoints:   []string{DownloadFileRPC},
		FileSizeKB:  256,
		WarmupFiles: 30,
	},
	{
		ID:          "mixed-files",
		Name:        "Mixed file I/O",
		Description: "UploadFile, DownloadFile and CompressFile together with equal probability.",
		Endpoints:   []string{UploadFileRPC, DownloadFileRPC, CompressFileRPC},
		FileSizeKB:  256,
		WarmupFiles: 20,
	},
	{
		ID:          "user-light",
		Name:        "User API (stateless)",
		Description: "CreateUser and GetUser. Light CPU load. GetUser often fails when hitting a different instance than CreateUser — shows stateless LB behavior.",
		Endpoints:   []string{CreateUserRPC, GetUserRPC},
		FileSizeKB:  0,
		WarmupFiles: 0,
	},
	{
		ID:          "full-mixed",
		Name:        "Full mixed workload",
		Description: "All five RPC methods. Best overall scenario before switching Envoy lb_policy and comparing Grafana dashboards.",
		Endpoints:   []string{UploadFileRPC, DownloadFileRPC, CompressFileRPC, CreateUserRPC, GetUserRPC},
		FileSizeKB:  128,
		WarmupFiles: 15,
	},
}

func GetPresets() []Preset {
	result := make([]Preset, len(presets))
	copy(result, presets)
	return result
}

func ResolvePreset(id string) (*Preset, bool) {
	for i := range presets {
		if presets[i].ID == id {
			p := presets[i]
			return &p, true
		}
	}
	return nil, false
}

func (c TestConfig) WithDefaults() TestConfig {
	cfg := c
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 20
	}
	if cfg.Duration < 0 {
		cfg.Duration = 60
	}
	if cfg.FileSizeKB <= 0 {
		cfg.FileSizeKB = 256
	}
	if cfg.WarmupFiles < 0 {
		cfg.WarmupFiles = 0
	}

	if cfg.Preset != "" {
		if preset, ok := ResolvePreset(cfg.Preset); ok {
			if len(cfg.Endpoints) == 0 {
				cfg.Endpoints = append([]string(nil), preset.Endpoints...)
			}
			if c.FileSizeKB <= 0 && preset.FileSizeKB > 0 {
				cfg.FileSizeKB = preset.FileSizeKB
			}
			if c.WarmupFiles <= 0 && preset.WarmupFiles > 0 {
				cfg.WarmupFiles = preset.WarmupFiles
			}
		}
	}

	if cfg.FileSizeKB <= 0 {
		cfg.FileSizeKB = 256
	}

	return cfg
}

func (c TestConfig) needsDownloadWarmup() bool {
	for _, endpoint := range c.Endpoints {
		if endpoint == DownloadFileRPC {
			return true
		}
	}
	return false
}

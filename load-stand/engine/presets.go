package engine

const (
	UploadFileRPC   = "/filefarm.file.FileService/UploadFile"
	DownloadFileRPC = "/filefarm.file.FileService/DownloadFile"
	CompressFileRPC = "/filefarm.file.FileService/CompressFile"
	CreateUserRPC   = "/filefarm.user.UserService/CreateUser"
	GetUserRPC      = "/filefarm.user.UserService/GetUser"
	DeleteFileRPC   = "/filefarm.file.FileService/DeleteFile"
)

// MaxTestFileSizeKB is the largest raw file whose base64 body still fits in the
// default 4 MB gRPC message limit, leaving room for protobuf fields and gzip output.
func MaxTestFileSizeKB() int {
	const (
		defaultGrpcMessageBytes = 4 * 1024 * 1024
		messageOverheadBytes    = 64 * 1024
	)
	rawBytes := ((defaultGrpcMessageBytes - messageOverheadBytes) / 4) * 3
	return rawBytes / 1024
}

func clampFileSizeKB(sizeKB int) int {
	limit := MaxTestFileSizeKB()
	if sizeKB > limit {
		return limit
	}
	return sizeKB
}

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
	if cfg.WarmupFiles < 0 {
		cfg.WarmupFiles = 0
	}

	var preset *Preset
	if cfg.Preset != "" {
		if resolvedPreset, ok := ResolvePreset(cfg.Preset); ok {
			preset = resolvedPreset
			if len(cfg.Endpoints) == 0 {
				cfg.Endpoints = append([]string(nil), resolvedPreset.Endpoints...)
			}
			if c.WarmupFiles <= 0 && resolvedPreset.WarmupFiles > 0 {
				cfg.WarmupFiles = resolvedPreset.WarmupFiles
			}
		}
	}

	if c.FileSizeMinKB <= 0 && c.FileSizeMaxKB <= 0 {
		fixedSizeKB := c.FileSizeKB
		if fixedSizeKB <= 0 && preset != nil {
			fixedSizeKB = preset.FileSizeKB
		}
		if fixedSizeKB > 0 {
			cfg.FileSizeMinKB = fixedSizeKB
			cfg.FileSizeMaxKB = fixedSizeKB
		} else {
			cfg.FileSizeMinKB = 128
			cfg.FileSizeMaxKB = 1024
		}
	} else {
		if cfg.FileSizeMinKB <= 0 {
			cfg.FileSizeMinKB = 128
		}
		if cfg.FileSizeMaxKB <= 0 {
			cfg.FileSizeMaxKB = 1024
		}
	}
	cfg.FileSizeMinKB = clampFileSizeKB(cfg.FileSizeMinKB)
	cfg.FileSizeMaxKB = clampFileSizeKB(cfg.FileSizeMaxKB)
	if cfg.FileSizeMinKB > cfg.FileSizeMaxKB {
		cfg.FileSizeMinKB = cfg.FileSizeMaxKB
	}
	cfg.FileSizeKB = (cfg.FileSizeMinKB + cfg.FileSizeMaxKB) / 2
	for index := range cfg.Phases {
		cfg.Phases[index].FileSizeMinKB = clampFileSizeKB(cfg.Phases[index].FileSizeMinKB)
		cfg.Phases[index].FileSizeMaxKB = clampFileSizeKB(cfg.Phases[index].FileSizeMaxKB)
		if cfg.Phases[index].FileSizeMinKB > cfg.Phases[index].FileSizeMaxKB {
			cfg.Phases[index].FileSizeMinKB = cfg.Phases[index].FileSizeMaxKB
		}
	}
	if len(cfg.Phases) > 0 {
		cfg.Concurrency = cfg.Phases[0].Concurrency
		cfg.FileSizeMinKB = cfg.Phases[0].FileSizeMinKB
		cfg.FileSizeMaxKB = cfg.Phases[0].FileSizeMaxKB
		cfg.FileSizeKB = (cfg.FileSizeMinKB + cfg.FileSizeMaxKB) / 2
		iterations := 1
		if cfg.WaveIterations != nil && *cfg.WaveIterations >= 0 {
			iterations = *cfg.WaveIterations
		}
		resolved := iterations
		cfg.WaveIterations = &resolved
		cycleSeconds := 0
		for _, phase := range cfg.Phases {
			cycleSeconds += phase.DurationSec
		}
		if iterations == 0 {
			cfg.Duration = 0
		} else {
			cfg.Duration = cycleSeconds * iterations
		}
	}

	return cfg
}

func (c TestConfig) needsDownloadWarmup() bool {
	for _, endpoint := range c.Endpoints {
		if endpoint == DownloadFileRPC || endpoint == DeleteFileRPC {
			return true
		}
	}
	return false
}

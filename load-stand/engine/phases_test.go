package engine

import "testing"

func TestPhasesReplaceSteadyLoad(t *testing.T) {
	config := (TestConfig{
		Concurrency:   99,
		Duration:      10,
		FileSizeMinKB: 1,
		FileSizeMaxKB: 2,
		Phases: []LoadPhase{
			{Concurrency: 8, DurationSec: 40, FileSizeMinKB: 256, FileSizeMaxKB: 512},
			{Concurrency: 48, DurationSec: 50, FileSizeMinKB: 1024, FileSizeMaxKB: 3072},
		},
	}).WithDefaults()

	if config.Concurrency != 8 || config.Duration != 90 {
		t.Fatalf("expected first wave and summed duration, got concurrency=%d duration=%d", config.Concurrency, config.Duration)
	}
	if config.FileSizeMinKB != 256 || config.FileSizeMaxKB != 512 {
		t.Fatalf("expected first-wave file size, got %d-%d", config.FileSizeMinKB, config.FileSizeMaxKB)
	}
}

func TestZeroWaveIterationsStayOpen(t *testing.T) {
	zero := 0
	config := (TestConfig{
		FileSizeMinKB:  256,
		FileSizeMaxKB:  512,
		WaveIterations: &zero,
		Phases: []LoadPhase{
			{Concurrency: 8, DurationSec: 40, FileSizeMinKB: 256, FileSizeMaxKB: 512},
			{Concurrency: 8, DurationSec: 50, FileSizeMinKB: 256, FileSizeMaxKB: 512},
		},
	}).WithDefaults()
	if config.Duration != 0 || config.WaveIterations == nil || *config.WaveIterations != 0 {
		t.Fatalf("expected an open-ended wave run, got duration=%d iterations=%v", config.Duration, config.WaveIterations)
	}
}

func TestRepeatedWavesMultiplyDuration(t *testing.T) {
	repeats := 2
	config := (TestConfig{
		FileSizeMinKB:  256,
		FileSizeMaxKB:  512,
		WaveIterations: &repeats,
		Phases: []LoadPhase{
			{Concurrency: 8, DurationSec: 40, FileSizeMinKB: 256, FileSizeMaxKB: 512},
			{Concurrency: 8, DurationSec: 50, FileSizeMinKB: 256, FileSizeMaxKB: 512},
		},
	}).WithDefaults()
	if config.Duration != 180 {
		t.Fatalf("expected two cycles of 90s, got %d", config.Duration)
	}
}

func TestValidatePhasesRejectsShortWave(t *testing.T) {
	err := validatePhases([]LoadPhase{{
		Concurrency:   1,
		DurationSec:   4,
		FileSizeMinKB: 128,
		FileSizeMaxKB: 256,
	}})
	if err == nil {
		t.Fatal("expected a short wave to be rejected")
	}
}

func TestPayloadBuilderCanChangeSizeDuringLoad(t *testing.T) {
	builder := NewPayloadBuilder(128, 256)
	builder.SetFileSizeRange(512, 1024)
	for sample := 0; sample < 200; sample++ {
		size := builder.nextFileSizeKB()
		if size < 512 || size > 1024 {
			t.Fatalf("size %d KB is outside the updated range", size)
		}
	}
}

func TestOversizedFileIsClampedToGrpcLimit(t *testing.T) {
	config := (TestConfig{FileSizeMinKB: 8192, FileSizeMaxKB: 16384}).WithDefaults()
	limit := MaxTestFileSizeKB()
	if config.FileSizeMinKB != limit || config.FileSizeMaxKB != limit {
		t.Fatalf("expected both bounds clamped to %d KB, got %d-%d", limit, config.FileSizeMinKB, config.FileSizeMaxKB)
	}
	encoded := ((limit * 1024) + 2) / 3 * 4
	if encoded+64*1024 > 4*1024*1024 {
		t.Fatalf("clamped file base64 %d plus overhead exceeds 4 MB", encoded)
	}
}

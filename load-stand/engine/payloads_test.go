package engine

import "testing"

func TestFileSizeDefaultsTo128KBThrough1MB(t *testing.T) {
	config := (TestConfig{}).WithDefaults()
	if config.FileSizeMinKB != 128 || config.FileSizeMaxKB != 1024 {
		t.Fatalf("expected 128-1024 KB, got %d-%d", config.FileSizeMinKB, config.FileSizeMaxKB)
	}
}

func TestPresetKeepsFixedFileSize(t *testing.T) {
	config := (TestConfig{Preset: "upload-heavy"}).WithDefaults()
	if config.FileSizeMinKB != 512 || config.FileSizeMaxKB != 512 {
		t.Fatalf("expected preset size 512 KB, got %d-%d", config.FileSizeMinKB, config.FileSizeMaxKB)
	}
}

func TestPayloadBuilderUsesInclusiveSizeRange(t *testing.T) {
	builder := NewPayloadBuilder(128, 1024)
	for sample := 0; sample < 1000; sample++ {
		size := builder.nextFileSizeKB()
		if size < 128 || size > 1024 {
			t.Fatalf("random size %d KB is outside 128-1024 KB", size)
		}
	}
}

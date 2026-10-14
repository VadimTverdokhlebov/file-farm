package engine

import "testing"

func TestPreserveEndpointWeightsKeepsLastValuesWhenScrapeIsEmpty(t *testing.T) {
	lastEndpointWeights = map[string]float64{}

	first := []ServerStatus{
		{Name: "file-farm-server-1", EDS: 120},
		{Name: "file-farm-server-2", EDS: 380},
	}
	preserveEndpointWeights(first)

	miss := []ServerStatus{
		{Name: "file-farm-server-1", EDS: 0, Status: "up"},
		{Name: "file-farm-server-2", EDS: 0, Status: "up"},
	}
	preserveEndpointWeights(miss)
	if miss[0].EDS != 120 || miss[1].EDS != 380 {
		t.Fatalf("empty scrape should keep the last weights, got %+v", miss)
	}
}

func TestPreserveEndpointWeightsLeavesARealZeroAlone(t *testing.T) {
	lastEndpointWeights = map[string]float64{}

	sample := []ServerStatus{
		{Name: "file-farm-server-1", EDS: 0},
		{Name: "file-farm-server-2", EDS: 500},
	}
	preserveEndpointWeights(sample)
	if sample[0].EDS != 0 || sample[1].EDS != 500 {
		t.Fatalf("a reported zero next to a live weight must stay, got %+v", sample)
	}
}

package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/jhump/protoreflect/desc/protoparse"
)

func ParseProtoFiles(protoDir string) ([]string, error) {
	var relativeProtoFiles []string

	protoRoot, err := filepath.Abs(protoDir)
	if err != nil {
		return nil, fmt.Errorf("failed to get absolute path for %s: %w", protoDir, err)
	}

	err = filepath.Walk(protoRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && filepath.Ext(path) == ".proto" {
			relativePath, err := filepath.Rel(protoRoot, path)
			if err != nil {
				return err
			}
			relativeProtoFiles = append(relativeProtoFiles, relativePath)
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("error searching .proto files: %w", err)
	}

	if len(relativeProtoFiles) == 0 {
		return nil, fmt.Errorf("no .proto files found in '%s'", protoDir)
	}

	parser := protoparse.Parser{
		ImportPaths: []string{protoRoot},
	}

	fileDescriptors, err := parser.ParseFiles(relativeProtoFiles...)
	if err != nil {
		return nil, fmt.Errorf("error parsing .proto files: %w", err)
	}

	var endpoints []string
	for _, fd := range fileDescriptors {
		isOriginalFile := false
		for _, originalFile := range relativeProtoFiles {
			if fd.GetName() == strings.ReplaceAll(originalFile, "\\", "/") {
				isOriginalFile = true
				break
			}
		}

		if !isOriginalFile {
			continue
		}

		for _, sd := range fd.GetServices() {
			for _, md := range sd.GetMethods() {
				endpointName := fmt.Sprintf("/%s/%s", sd.GetFullyQualifiedName(), md.GetName())
				endpoints = append(endpoints, endpointName)
			}
		}
	}

	return removeDuplicates(endpoints), nil
}

func removeDuplicates(elements []string) []string {
	encountered := make(map[string]bool)
	result := []string{}

	for _, v := range elements {
		if !encountered[v] {
			encountered[v] = true
			result = append(result, v)
		}
	}
	return result
}

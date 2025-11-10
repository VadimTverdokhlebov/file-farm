package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/jhump/protoreflect/desc/protoparse"
)

// ParseProtoFiles сканирует директорию, находит все .proto файлы и извлекает имена сервисов и методов.
func ParseProtoFiles(protoDir string) ([]string, error) {
	var relativeProtoFiles []string // Будем хранить относительные пути
	
    // Нормализуем путь к директории
    protoRoot, err := filepath.Abs(protoDir)
    if err != nil {
        return nil, fmt.Errorf("не удалось получить абсолютный путь для %s: %w", protoDir, err)
    }

	err = filepath.Walk(protoRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && filepath.Ext(path) == ".proto" {
			// Получаем путь к файлу относительно protoRoot
			relativePath, err := filepath.Rel(protoRoot, path)
			if err != nil {
				return err
			}
			relativeProtoFiles = append(relativeProtoFiles, relativePath)
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("ошибка при поиске .proto файлов: %w", err)
	}

	if len(relativeProtoFiles) == 0 {
		return nil, fmt.Errorf("в директории '%s' не найдено .proto файлов", protoDir)
	}

	// Используем protoparse для парсинга файлов
	parser := protoparse.Parser{
		ImportPaths: []string{protoRoot}, // Указываем АБСОЛЮТНЫЙ путь как корень для импортов
	}

    // Передаем парсеру ОТНОСИТЕЛЬНЫЕ пути
	fileDescriptors, err := parser.ParseFiles(relativeProtoFiles...)
	if err != nil {
		// Предоставляем более детальную ошибку
		return nil, fmt.Errorf("ошибка при парсинге .proto файлов. Проверьте директиву 'import' и 'package'. Ошибка: %w", err)
	}

	var endpoints []string
	for _, fd := range fileDescriptors {
		// Чтобы избежать дублирования из-за импортов, проверяем, был ли этот файл в нашем исходном списке
		isOriginalFile := false
		for _, originalFile := range relativeProtoFiles {
			// protoparse может использовать разделители '/', независимо от ОС
			if fd.GetName() == strings.ReplaceAll(originalFile, "\\", "/") {
				isOriginalFile = true
				break
			}
		}

		if !isOriginalFile {
			continue // Это импортированный файл, его сервисы будут обработаны, когда мы дойдем до файла, который его импортировал
		}

		for _, sd := range fd.GetServices() {
			for _, md := range sd.GetMethods() {
				// Формируем полное имя метода в стандартном формате gRPC
				endpointName := fmt.Sprintf("/%s/%s", sd.GetFullyQualifiedName(), md.GetName())
				endpoints = append(endpoints, endpointName)
			}
		}
	}

	return removeDuplicates(endpoints), nil
}

// removeDuplicates удаляет дубликаты из среза строк
func removeDuplicates(elements []string) []string {
    encountered := map[string]bool{}
    result := []string{}

    for _, v := range elements {
        if encountered[v] == false {
            encountered[v] = true
            result = append(result, v)
        }
    }
    return result
}
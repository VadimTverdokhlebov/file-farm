package engine

import (
	cryptorand "crypto/rand"
	"encoding/base64"
	"fmt"
	mathrand "math/rand"
	"sync"
	"sync/atomic"

	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/dynamic"
)

type PayloadBuilder struct {
	fileSizeKB      int
	uploadCounter   atomic.Int64
	userCounter     atomic.Int64
	uploadedFiles   []string
	createdLogins   []string
	mu              sync.RWMutex
}

func NewPayloadBuilder(fileSizeKB int) *PayloadBuilder {
	return &PayloadBuilder{fileSizeKB: fileSizeKB}
}

func (b *PayloadBuilder) RecordUploadedFile(filename string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.uploadedFiles = append(b.uploadedFiles, filename)
}

func (b *PayloadBuilder) RecordCreatedLogin(login string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.createdLogins = append(b.createdLogins, login)
}

func (b *PayloadBuilder) Populate(md *desc.MethodDescriptor, msg *dynamic.Message) error {
	service := md.GetService().GetFullyQualifiedName()
	methodKey := fmt.Sprintf("%s/%s", service, md.GetName())

	switch methodKey {
	case "filefarm.file.FileService/UploadFile":
		return b.fillUpload(msg)
	case "filefarm.file.FileService/DownloadFile":
		return b.fillDownload(msg)
	case "filefarm.user.UserService/CreateUser":
		return b.fillCreateUser(msg)
	case "filefarm.user.UserService/GetUser":
		return b.fillGetUser(msg)
	default:
		return nil
	}
}

func (b *PayloadBuilder) HandleResponse(md *desc.MethodDescriptor, req *dynamic.Message) {
	service := md.GetService().GetFullyQualifiedName()
	methodKey := fmt.Sprintf("%s/%s", service, md.GetName())

	switch methodKey {
	case "filefarm.file.FileService/UploadFile":
		if filename, err := req.TryGetFieldByName("filename"); err == nil {
			b.RecordUploadedFile(fmt.Sprint(filename))
		}
	case "filefarm.user.UserService/CreateUser":
		if login, err := req.TryGetFieldByName("login"); err == nil {
			b.RecordCreatedLogin(fmt.Sprint(login))
		}
	}
}

func (b *PayloadBuilder) fillUpload(msg *dynamic.Message) error {
	id := b.uploadCounter.Add(1)
	filename := fmt.Sprintf("loadtest_%d.bin", id)

	rawSize := b.fileSizeKB * 1024
	if rawSize <= 0 {
		rawSize = 256 * 1024
	}

	payload := make([]byte, rawSize)
	if _, err := cryptorand.Read(payload); err != nil {
		return err
	}

	if err := msg.TrySetFieldByName("filename", filename); err != nil {
		return err
	}
	if err := msg.TrySetFieldByName("content", base64.StdEncoding.EncodeToString(payload)); err != nil {
		return err
	}
	if err := msg.TrySetFieldByName("mimetype", "application/octet-stream"); err != nil {
		return err
	}

	return nil
}

func (b *PayloadBuilder) fillDownload(msg *dynamic.Message) error {
	b.mu.RLock()
	defer b.mu.RUnlock()

	filename := "loadtest_warmup.bin"
	if len(b.uploadedFiles) > 0 {
		filename = b.uploadedFiles[mathrand.Intn(len(b.uploadedFiles))]
	}

	return msg.TrySetFieldByName("filename", filename)
}

func (b *PayloadBuilder) fillCreateUser(msg *dynamic.Message) error {
	id := b.userCounter.Add(1)
	login := fmt.Sprintf("loaduser_%d", id)
	name := fmt.Sprintf("Load User %d", id)

	if err := msg.TrySetFieldByName("login", login); err != nil {
		return err
	}
	return msg.TrySetFieldByName("name", name)
}

func (b *PayloadBuilder) fillGetUser(msg *dynamic.Message) error {
	b.mu.RLock()
	defer b.mu.RUnlock()

	login := "missing_user"
	if len(b.createdLogins) > 0 {
		login = b.createdLogins[mathrand.Intn(len(b.createdLogins))]
	}

	return msg.TrySetFieldByName("login", login)
}

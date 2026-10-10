import { useRef, useState } from 'react';
import { compressFile, deleteFile, downloadFile, uploadFile } from '../api/fileService';
import { saveBytes } from '../api/codec';

export type FileNotice = {
  tone: 'success' | 'error';
  text: string;
};

export type SessionFile = {
  name: string;
  size: number;
  type: string;
};

function errorText(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function useFiles() {
  const [uploadSelection, setUploadSelection] = useState<File | null>(null);
  const [compressSelection, setCompressSelection] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [compressInputKey, setCompressInputKey] = useState(0);
  const [filename, setFilename] = useState('');
  const [sessionFiles, setSessionFiles] = useState<SessionFile[]>([]);
  const [notices, setNotices] = useState<Record<string, FileNotice | null>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  const notify = (key: string, notice: FileNotice | null) => {
    setNotices((current) => ({ ...current, [key]: notice }));
  };

  const rememberFile = (file: SessionFile) => {
    setSessionFiles((current) => [file, ...current.filter((item) => item.name !== file.name)]);
  };

  const run = async (pendingKey: string, noticeKey: string, action: () => Promise<void>, fallback: string) => {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = pendingKey;
    setPending(pendingKey);
    notify(noticeKey, null);
    try {
      await action();
    } catch (error) {
      setDeleteTarget(null);
      notify(noticeKey, { tone: 'error', text: errorText(error, fallback) });
    } finally {
      if (pendingRef.current === pendingKey) {
        pendingRef.current = null;
      }
      setPending((current) => (current === pendingKey ? null : current));
    }
  };

  const upload = () => run('upload', 'upload', async () => {
    if (!uploadSelection) {
      notify('upload', { tone: 'error', text: 'Choose a file first' });
      return;
    }
    const message = await uploadFile(uploadSelection);
    rememberFile({
      name: uploadSelection.name,
      size: uploadSelection.size,
      type: uploadSelection.type || 'application/octet-stream',
    });
    setUploadSelection(null);
    setUploadInputKey((value) => value + 1);
    notify('upload', { tone: 'success', text: message });
  }, 'Failed to upload file');

  const compress = () => run('compress', 'compress', async () => {
    if (!compressSelection) {
      notify('compress', { tone: 'error', text: 'Choose a file first' });
      return;
    }
    const result = await compressFile(compressSelection);
    saveBytes(`${compressSelection.name}.gz`, result.bytes, 'application/gzip');
    setCompressSelection(null);
    setCompressInputKey((value) => value + 1);
    notify('compress', { tone: 'success', text: result.message });
  }, 'Failed to compress file');

  const download = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      notify('lookup', { tone: 'error', text: 'Enter a file name' });
      return;
    }
    void run(`download:${trimmed}`, 'lookup', async () => {
      const bytes = await downloadFile(trimmed);
      saveBytes(trimmed, bytes);
      notify('lookup', { tone: 'success', text: `Downloaded ${trimmed}` });
    }, 'Failed to download file');
  };

  const askDelete = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      notify('lookup', { tone: 'error', text: 'Enter a file name' });
      return;
    }
    notify('lookup', null);
    setDeleteTarget(trimmed);
  };

  const cancelDelete = () => setDeleteTarget(null);

  const confirmDelete = () => {
    if (!deleteTarget) {
      return;
    }
    const name = deleteTarget;
    void run(`delete:${name}`, 'lookup', async () => {
      const message = await deleteFile(name);
      setSessionFiles((current) => current.filter((item) => item.name !== name));
      setDeleteTarget(null);
      setFilename((current) => (current.trim() === name ? '' : current));
      notify('lookup', { tone: 'success', text: message });
    }, 'Failed to delete file');
  };

  return {
    uploadSelection,
    setUploadSelection,
    compressSelection,
    setCompressSelection,
    uploadInputKey,
    compressInputKey,
    filename,
    setFilename,
    sessionFiles,
    notices,
    pending,
    deleteTarget,
    upload,
    compress,
    download,
    askDelete,
    cancelDelete,
    confirmDelete,
  };
}

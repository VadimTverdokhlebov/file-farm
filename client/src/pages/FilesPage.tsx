import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { formatBytes } from '../api/codec';
import { FileNotice, SessionFile, useFiles } from '../hooks/useFiles';
import './FilesPage.css';

export const FilesPage = () => {
  const files = useFiles();
  const busy = files.pending !== null;

  return (
    <div className="files-page">
      <div className="files-shell">
        <header className="files-header">
          <div>
            <p className="files-kicker">File Farm</p>
            <h1>Files</h1>
            <p className="files-lead">
              Upload a file to the cluster, compress one without storing it, or download and delete a stored file by name.
            </p>
          </div>
          <Link className="files-nav" to="/load-test">Load test</Link>
        </header>

        <div className="files-grid">
          <FileActionCard
            title="Upload"
            description="The file is stored and can be downloaded or deleted later."
            inputId="upload-file"
            inputKey={files.uploadInputKey}
            file={files.uploadSelection}
            onSelect={files.setUploadSelection}
            actionLabel={files.pending === 'upload' ? 'Uploading...' : 'Upload'}
            disabled={busy || !files.uploadSelection}
            onAction={files.upload}
            notice={files.notices.upload}
          />
          <FileActionCard
            title="Compress"
            description="Returns a gzip copy. The original is not saved on the server."
            inputId="compress-file"
            inputKey={files.compressInputKey}
            file={files.compressSelection}
            onSelect={files.setCompressSelection}
            actionLabel={files.pending === 'compress' ? 'Compressing...' : 'Compress'}
            disabled={busy || !files.compressSelection}
            onAction={files.compress}
            notice={files.notices.compress}
          />
        </div>

        <section className="files-library">
          <div className="files-library-head">
            <h2>Stored files</h2>
            <p>Files uploaded in this session are listed here. Any other stored name can be used below.</p>
          </div>

          {files.sessionFiles.length === 0 ? (
            <p className="files-empty">No files uploaded in this session yet.</p>
          ) : (
            <ul className="files-list">
              {files.sessionFiles.map((file) => (
                <SessionFileRow
                  key={file.name}
                  file={file}
                  busy={busy}
                  pending={files.pending}
                  onDownload={() => files.download(file.name)}
                  onDelete={() => files.askDelete(file.name)}
                />
              ))}
            </ul>
          )}

          <div className="files-lookup">
            <Input
              label="File name"
              placeholder="Stored file name"
              value={files.filename}
              onChange={files.setFilename}
            />
            <div className="files-lookup-actions">
              <Button onClick={() => files.download(files.filename)} disabled={busy || !files.filename.trim()}>
                {files.pending === `download:${files.filename.trim()}` ? 'Downloading...' : 'Download'}
              </Button>
              <Button
                variant="danger"
                onClick={() => files.askDelete(files.filename)}
                disabled={busy || !files.filename.trim()}
              >
                Delete
              </Button>
            </div>
          </div>

          {files.deleteTarget && (
            <div className="files-confirm">
              <p>Delete <strong>{files.deleteTarget}</strong> from the cluster?</p>
              <div className="files-lookup-actions">
                <Button variant="danger" onClick={files.confirmDelete} disabled={busy}>
                  {files.pending?.startsWith('delete:') ? 'Deleting...' : 'Delete file'}
                </Button>
                <Button variant="secondary" onClick={files.cancelDelete} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <Notice notice={files.notices.lookup} />
        </section>
      </div>
    </div>
  );
};

type FileActionCardProps = {
  title: string;
  description: string;
  inputId: string;
  inputKey: number;
  file: File | null;
  onSelect: (file: File | null) => void;
  actionLabel: string;
  disabled: boolean;
  onAction: () => void;
  notice?: FileNotice | null;
};

function FileActionCard({
  title,
  description,
  inputId,
  inputKey,
  file,
  onSelect,
  actionLabel,
  disabled,
  onAction,
  notice,
}: FileActionCardProps) {
  return (
    <section className="files-card">
      <h2>{title}</h2>
      <p className="files-card-copy">{description}</p>
      <label className="files-drop" htmlFor={inputId}>
        <span>{file ? file.name : 'Choose a file'}</span>
        <input
          key={inputKey}
          id={inputId}
          type="file"
          onChange={(event) => onSelect(event.target.files?.[0] ?? null)}
        />
      </label>
      {file && (
        <p className="files-meta">
          {formatBytes(file.size)} · {file.type || 'Unknown type'}
        </p>
      )}
      <Button onClick={onAction} disabled={disabled}>{actionLabel}</Button>
      <Notice notice={notice} />
    </section>
  );
}

function SessionFileRow({
  file,
  busy,
  pending,
  onDownload,
  onDelete,
}: {
  file: SessionFile;
  busy: boolean;
  pending: string | null;
  onDownload: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="files-row">
      <div>
        <p className="files-row-name">{file.name}</p>
        <p className="files-meta">{formatBytes(file.size)} · {file.type}</p>
      </div>
      <div className="files-row-actions">
        <Button
          variant="secondary"
          onClick={onDownload}
          disabled={busy}
        >
          {pending === `download:${file.name}` ? 'Downloading...' : 'Download'}
        </Button>
        <Button variant="danger" onClick={onDelete} disabled={busy}>
          Delete
        </Button>
      </div>
    </li>
  );
}

function Notice({ notice }: { notice?: FileNotice | null }) {
  if (!notice) {
    return null;
  }
  return <p className={`files-notice files-notice-${notice.tone}`}>{notice.text}</p>;
}

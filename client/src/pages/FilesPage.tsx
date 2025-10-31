import { useState, useRef } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { fileService } from '../api/fileService';
import './FilesPage.css';

export const FilesPage = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [downloadFileName, setDownloadFileName] = useState('');
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const downloadLinkRef = useRef<HTMLAnchorElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setUploadStatus(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadStatus('Please select a file first');
      return;
    }

    setLoading(true);
    setUploadStatus(null);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      const response = await fileService.uploadFile({
        filename: selectedFile.name,
        content: uint8Array,
        mimetype: selectedFile.type || 'application/octet-stream',
      });

      setUploadStatus(`Success: ${response.message} (${(response.fileSize / 1024).toFixed(2)} KB)`);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      setUploadStatus(
        `Error: ${error instanceof Error ? error.message : 'Failed to upload file'}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!downloadFileName.trim()) {
      setDownloadStatus('Please enter a file name');
      return;
    }

    setLoading(true);
    setDownloadStatus(null);

    try {
      const response = await fileService.downloadFile({
        filename: downloadFileName,
      });

      // Create blob and download
      const contentArray = response.content instanceof Uint8Array 
        ? response.content 
        : new Uint8Array(response.content);
      // Convert to ArrayBuffer if needed
      const buffer = contentArray.buffer.slice(0, contentArray.byteLength);
      const blob = new Blob([buffer as ArrayBuffer], { type: response.mimetype });
      const url = URL.createObjectURL(blob);

      if (downloadLinkRef.current) {
        downloadLinkRef.current.href = url;
        downloadLinkRef.current.download = downloadFileName;
        downloadLinkRef.current.click();
      }

      URL.revokeObjectURL(url);
      setDownloadStatus(`File "${downloadFileName}" downloaded successfully`);
      setDownloadFileName('');
    } catch (error) {
      setDownloadStatus(
        `Error: ${error instanceof Error ? error.message : 'Failed to download file'}`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="files-page">
      <div className="files-container">
        <div className="header">
          <h1>File Farm</h1>
        </div>

        <div className="sections">
          <section className="upload-section">
            <h2>Upload File</h2>
            <div className="file-input-wrapper">
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                className="file-input"
                id="file-input"
              />
              <label htmlFor="file-input" className="file-input-label">
                {selectedFile ? selectedFile.name : 'Choose a file...'}
              </label>
            </div>
            {selectedFile && (
              <div className="file-info">
                <p>File: {selectedFile.name}</p>
                <p>Size: {(selectedFile.size / 1024).toFixed(2)} KB</p>
                <p>Type: {selectedFile.type || 'Unknown'}</p>
              </div>
            )}
            <Button onClick={handleUpload} disabled={!selectedFile || loading}>
              {loading ? 'Uploading...' : 'Upload File'}
            </Button>
            {uploadStatus && (
              <div
                className={`status-message ${
                  uploadStatus.startsWith('Success') ? 'success' : 'error'
                }`}
              >
                {uploadStatus}
              </div>
            )}
          </section>

          <section className="download-section">
            <h2>Download File</h2>
            <Input
              type="text"
              placeholder="Enter file name to download"
              value={downloadFileName}
              onChange={setDownloadFileName}
              label="File Name"
            />
            <Button onClick={handleDownload} disabled={!downloadFileName || loading}>
              {loading ? 'Downloading...' : 'Download File'}
            </Button>
            {downloadStatus && (
              <div
                className={`status-message ${
                  downloadStatus.startsWith('File') ? 'success' : 'error'
                }`}
              >
                {downloadStatus}
              </div>
            )}
          </section>
        </div>
      </div>

      <a ref={downloadLinkRef} style={{ display: 'none' }} />
    </div>
  );
};


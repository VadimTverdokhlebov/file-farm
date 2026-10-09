import { useState, useRef } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { handleUploadFile, handleDownloadFile, handleCompressFile } from '../api/fileService';
import './FilesPage.css';

export const FilesPage = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [downloadFileName, setDownloadFileName] = useState('');
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [selectedCompressFile, setSelectedCompressFile] = useState<File | null>(null);
  const [compressedFileStatus, setCompressedFileStatus] = useState<string | null>(null);
  const [loadingCompressed, setLoadingCompressed] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const compressFileInputRef = useRef<HTMLInputElement>(null);
  const downloadLinkRef = useRef<HTMLAnchorElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setUploadStatus(null);
    }
  };

  const handleCompressFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedCompressFile(file);
      setCompressedFileStatus(null);
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

      const response = await handleUploadFile(selectedFile.name, uint8Array, selectedFile.type || 'application/octet-stream');

      if (response.success) {
        setUploadStatus(`Success: ${response.message}`);
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } else {
        setUploadStatus(`Error: ${response.message || 'Upload failed'}`);
      }
    } catch (error) {
      setUploadStatus(`Error: ${error instanceof Error ? error.message : 'Failed to upload file'}`);
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
      const content = await handleDownloadFile(downloadFileName);
      
      if (!content || content.length === 0) {
        setDownloadStatus('File not found or empty');
        return;
      }

      // Create blob and trigger download
      // Convert Uint8Array to ArrayBuffer for Blob compatibility
      const arrayBuffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
      const blob = new Blob([arrayBuffer]);
      const url = URL.createObjectURL(blob);
      if (downloadLinkRef.current) {
        downloadLinkRef.current.href = url;
        downloadLinkRef.current.download = downloadFileName;
        downloadLinkRef.current.click();
        URL.revokeObjectURL(url);
      }
      setDownloadStatus(`Success: File ${downloadFileName} downloaded`);
      setDownloadFileName('');
    } catch (error) {
      setDownloadStatus(`Error: ${error instanceof Error ? error.message : 'Failed to download file'}`);
    } finally {
      setLoading(false);
    }
  };

const handleCompress = async () => {
  const fileToCompress = selectedCompressFile; 

  if (!fileToCompress) {
    setCompressedFileStatus('Please select a file first');
    return;
  }

  setLoadingCompressed(true);
  setCompressedFileStatus(null);

  try {
    const arrayBuffer = await fileToCompress.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const response = await handleCompressFile(
      fileToCompress.name, 
      uint8Array, 
      fileToCompress.type || 'application/octet-stream'
    );

    if (!response.compressedContent || response.compressedContent.length === 0) {
      setCompressedFileStatus('File not found or empty');
      return;
    }

    if (response.success) {
      setCompressedFileStatus(`Success: ${response.message}`);
      
      const base64Content = response.compressedContent;
      const binaryString = atob(base64Content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: 'application/gzip' }); 
      const url = URL.createObjectURL(blob);

      if (downloadLinkRef.current) {
        const originalName = fileToCompress.name;
        const newFileName = `${originalName.split('.')[0]}_compressed.${originalName.split('.').pop()}.gz`;
        downloadLinkRef.current.href = url;
        downloadLinkRef.current.download = newFileName; 
        downloadLinkRef.current.click();
        
        URL.revokeObjectURL(url);
      }

      setSelectedCompressFile(null);
      if (compressFileInputRef.current) {
        compressFileInputRef.current.value = '';
      }

    } else {
      setCompressedFileStatus(`Error: ${response.message || 'Upload failed'}`);
    }
  } catch (error) {
    setCompressedFileStatus(`Error: ${error instanceof Error ? error.message : 'Failed to compress file'}`);
  } finally {
    setLoadingCompressed(false);
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

          <section className="upload-section">
            <h2>Compress File</h2>
            <div className="file-input-wrapper">
              <input
                ref={compressFileInputRef}
                type="file"
                onChange={handleCompressFileSelect}
                className="file-input"
                id="compress-file-input"
              />
              <label htmlFor="compress-file-input" className="file-input-label">
                {selectedCompressFile ? selectedCompressFile.name : 'Choose a file...'}
              </label>
            </div>
            {selectedCompressFile && (
              <div className="file-info">
                <p>File: {selectedCompressFile.name}</p>
                <p>Size: {(selectedCompressFile.size / 1024).toFixed(2)} KB</p>
                <p>Type: {selectedCompressFile.type || 'Unknown'}</p>
              </div>
            )}
            <Button onClick={handleCompress} disabled={!selectedCompressFile || loadingCompressed}>
              {loadingCompressed ? 'Compressing...' : 'Compress File'}
            </Button>
            {compressedFileStatus && (
              <div
                className={`status-message ${
                  compressedFileStatus.startsWith('Success') ? 'success' : 'error'
                }`}
              >
                {compressedFileStatus}
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
                  downloadStatus.startsWith('Success') ? 'success' : 'error'
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


import { useRef, useState } from 'react';

const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp';

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function fileIcon(file) {
  if (!file) return '📄';
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return '📕';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return '🖼️';
  return '📄';
}

export default function UploadZone({ file, setFile, datasets = [], setDatasets = () => {} }) {
  const inputRef = useRef();
  const datasetInputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handleDrop = e => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const handleChange = e => {
    if (e.target.files[0]) setFile(e.target.files[0]);
  };

  const handleAddDatasets = e => {
    const files = Array.from(e.target.files);
    setDatasets(prev => [...prev, ...files]);
  };

  const removeDataset = index => {
    setDatasets(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="upload-container">
      {/* Main Report Dropzone */}
      <div
        className={`drop-zone ${dragging ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        id="upload-dropzone"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          onChange={handleChange}
          style={{ display: 'none' }}
          id="file-input"
        />

        {file ? (
          <div className="file-info">
            <span className="file-info-icon">{fileIcon(file)}</span>
            <div>
              <div style={{ fontWeight: 600 }}>{file.name}</div>
              <div className="file-size">{formatBytes(file.size)} · Click to change</div>
            </div>
          </div>
        ) : (
          <>
            <span className="drop-icon">🔬</span>
            <div className="drop-title">Drop your lab report here</div>
            <div className="drop-sub">
              or <span>click to browse</span>
            </div>
          </>
        )}
      </div>

      <div className="format-badges">
        {['PDF', 'PNG', 'JPG', 'JPEG', 'WEBP'].map(fmt => (
          <span key={fmt} className="badge">{fmt}</span>
        ))}
      </div>

      {/* Datasets Section */}
      <div className="datasets-area">
        <div className="datasets-header">
          <div className="datasets-title">📁 Support Files (Datsets, CSVs)</div>
          <button 
            className="add-dataset-btn"
            onClick={() => datasetInputRef.current?.click()}
          >
            + Add Files
          </button>
          <input 
            ref={datasetInputRef}
            type="file" 
            multiple 
            style={{ display: 'none' }} 
            onChange={handleAddDatasets} 
          />
        </div>

        {datasets.length > 0 ? (
          <div className="datasets-list">
            {datasets.map((d, i) => (
              <div key={i} className="dataset-item">
                <span className="dataset-name">📊 {d.name} ({formatBytes(d.size)})</span>
                <button className="remove-dataset" onClick={() => removeDataset(i)}>✕</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="datasets-empty">No datasets added. Upload any CSVs mentioned in the lab.</div>
        )}
      </div>
    </div>
  );
}

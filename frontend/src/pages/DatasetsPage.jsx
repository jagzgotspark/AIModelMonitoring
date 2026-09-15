import { useEffect, useRef, useState } from "react";
import client from "../api/client.js";
import EmptyState from "../components/EmptyState.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { useToast } from "../context/ToastContext.jsx";

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewFor, setPreviewFor] = useState(null);
  const fileInputRef = useRef(null);
  const { showToast } = useToast();

  async function loadDatasets() {
    const { data } = await client.get("/datasets");
    setDatasets(data);
    setLoading(false);
  }

  useEffect(() => {
    loadDatasets();
  }, []);

  function addFiles(fileList) {
    const csvFiles = Array.from(fileList).filter((f) => f.name.endsWith(".csv"));
    if (csvFiles.length !== fileList.length) {
      showToast("Only .csv files are accepted — some files were skipped.", "error");
    }
    setFiles((prev) => [...prev, ...csvFiles]);
  }

  async function handleUpload() {
    if (!files.length) return;
    setUploading(true);
    let successCount = 0;
    const failures = [];

    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        await client.post("/datasets/upload", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        successCount += 1;
      } catch (err) {
        failures.push(`${file.name}: ${err.response?.data?.detail || "Upload failed"}`);
      }
    }

    if (successCount) showToast(`Uploaded ${successCount} dataset${successCount === 1 ? "" : "s"}`, "success");
    failures.forEach((msg) => showToast(msg, "error"));

    setFiles([]);
    setUploading(false);
    await loadDatasets();
  }

  async function handleSetTarget(datasetId, targetColumn) {
    if (!targetColumn) return;
    try {
      await client.put(`/datasets/${datasetId}/target`, { target_column: targetColumn });
      showToast("Target column set", "success");
      await loadDatasets();
    } catch (err) {
      showToast(err.response?.data?.detail || "Could not set target column", "error");
    }
  }

  async function handleDelete(datasetId) {
    try {
      await client.delete(`/datasets/${datasetId}`);
      showToast("Dataset deleted", "success");
      await loadDatasets();
    } catch (err) {
      showToast(err.response?.data?.detail || "Could not delete dataset", "error");
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Datasets</h2>
          <p>Drop one or more CSV files to make them available for training.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div
          className={`dropzone${dragActive ? " dragover" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            multiple
            onChange={(e) => addFiles(e.target.files)}
          />
          <div style={{ fontSize: 24 }}>↑</div>
          <div><strong>Click to browse</strong> or drag CSV files here</div>
          <div className="muted">You can select multiple files at once</div>
        </div>

        {files.length > 0 && (
          <>
            <div className="file-chip-list">
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`} className="file-chip">
                  {f.name} ({(f.size / 1024).toFixed(1)} KB)
                </span>
              ))}
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
              <button onClick={handleUpload} disabled={uploading}>
                {uploading ? `Uploading ${files.length}...` : `Upload ${files.length} file${files.length === 1 ? "" : "s"}`}
              </button>
              <button className="btn-secondary" onClick={() => setFiles([])} disabled={uploading}>
                Clear
              </button>
            </div>
          </>
        )}
      </div>

      {loading ? (
        <Skeleton height={160} />
      ) : datasets.length === 0 ? (
        <EmptyState icon="📄" title="No datasets yet" description="Upload a CSV above to get started." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Rows</th>
                <th>Columns</th>
                <th>Target column</th>
                <th>Task type</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((ds) => (
                <tr key={ds.id}>
                  <td>{ds.name}</td>
                  <td>{ds.n_rows}</td>
                  <td>{ds.n_columns}</td>
                  <td>
                    {ds.target_column || (
                      <TargetColumnPicker dataset={ds} onSelect={(col) => handleSetTarget(ds.id, col)} />
                    )}
                  </td>
                  <td>
                    {ds.task_type ? <span className="badge badge-neutral">{ds.task_type}</span> : "—"}
                  </td>
                  <td className="row-actions">
                    <button className="btn-secondary btn-sm" onClick={() => setPreviewFor(ds)}>
                      Preview
                    </button>
                    <button className="btn-danger btn-sm" onClick={() => handleDelete(ds.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewFor && <PreviewModal dataset={previewFor} onClose={() => setPreviewFor(null)} />}
    </div>
  );
}

function TargetColumnPicker({ dataset, onSelect }) {
  const columns = Object.keys(dataset.columns_meta || {});
  return (
    <select defaultValue="" onChange={(e) => onSelect(e.target.value)}>
      <option value="" disabled>
        Select target
      </option>
      {columns.map((col) => (
        <option key={col} value={col}>
          {col}
        </option>
      ))}
    </select>
  );
}

function PreviewModal({ dataset, onClose }) {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    client.get(`/datasets/${dataset.id}/preview`, { params: { limit: 10 } }).then(({ data }) => setPreview(data));
  }, [dataset.id]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,17,25,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "min(900px, 92vw)", maxHeight: "80vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0 }}>{dataset.name} — preview</h3>
          <button className="btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        {!preview ? (
          <Skeleton height={160} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {preview.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    {preview.columns.map((c) => (
                      <td key={c}>{row[c] === null || row[c] === undefined ? "—" : String(row[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

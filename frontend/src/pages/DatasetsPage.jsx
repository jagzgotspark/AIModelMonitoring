import { useEffect, useState } from "react";
import client from "../api/client.js";

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState([]);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function loadDatasets() {
    const { data } = await client.get("/datasets");
    setDatasets(data);
  }

  useEffect(() => {
    loadDatasets();
  }, []);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      await client.post("/datasets/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setFile(null);
      await loadDatasets();
    } catch (err) {
      setError(err.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSetTarget(datasetId, targetColumn) {
    if (!targetColumn) return;
    await client.put(`/datasets/${datasetId}/target`, { target_column: targetColumn });
    await loadDatasets();
  }

  return (
    <div>
      <h2>Datasets</h2>
      <form onSubmit={handleUpload} className="upload-form">
        <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} />
        <button type="submit" disabled={uploading || !file}>
          {uploading ? "Uploading..." : "Upload CSV"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Rows</th>
            <th>Columns</th>
            <th>Target column</th>
            <th>Task type</th>
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
              <td>{ds.task_type || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

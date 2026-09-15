import { useEffect, useState } from "react";
import client from "../api/client.js";

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split("\n");
  const headers = headerLine.split(",").map((h) => h.trim());
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = line.split(",");
      const record = {};
      headers.forEach((h, i) => {
        const raw = values[i]?.trim();
        const num = Number(raw);
        record[h] = raw !== "" && !Number.isNaN(num) ? num : raw;
      });
      return record;
    });
}

export default function DriftDashboardPage() {
  const [experiments, setExperiments] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [reports, setReports] = useState([]);
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    client.get("/experiments").then(({ data }) => setExperiments(data));
  }, []);

  const modelOptions = experiments.flatMap((exp) =>
    exp.model_versions.map((mv) => ({ id: mv.id, label: `${exp.name} — ${mv.algorithm}` }))
  );

  async function loadReports(modelVersionId) {
    if (!modelVersionId) return;
    const { data } = await client.get(`/drift/${modelVersionId}/reports`);
    setReports(data);
  }

  useEffect(() => {
    loadReports(selectedModelId);
  }, [selectedModelId]);

  async function handleCheckDrift(e) {
    e.preventDefault();
    if (!file || !selectedModelId) return;
    setError("");
    setChecking(true);
    try {
      const text = await file.text();
      const records = parseCsv(text);
      await client.post(`/drift/${selectedModelId}/check`, { records });
      await loadReports(selectedModelId);
      setFile(null);
    } catch (err) {
      setError(err.response?.data?.detail || "Drift check failed");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <h2>Drift monitoring</h2>
      <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
        <option value="">Select a model version</option>
        {modelOptions.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>

      <form onSubmit={handleCheckDrift} className="upload-form">
        <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} />
        <button type="submit" disabled={!file || !selectedModelId || checking}>
          {checking ? "Checking..." : "Check new data for drift"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      <table className="data-table">
        <thead>
          <tr>
            <th>Checked at</th>
            <th>Samples</th>
            <th>Drift score</th>
            <th>Alert</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.created_at).toLocaleString()}</td>
              <td>{r.n_samples}</td>
              <td>{r.overall_drift_score.toFixed(4)}</td>
              <td>
                {r.is_drifted ? (
                  <span className="badge badge-danger">Retraining recommended</span>
                ) : (
                  <span className="badge badge-ok">Stable</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

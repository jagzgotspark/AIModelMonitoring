import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import client from "../api/client.js";
import EmptyState from "../components/EmptyState.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { useToast } from "../context/ToastContext.jsx";

const DRIFT_THRESHOLD = 0.2;

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
  const [loadingReports, setLoadingReports] = useState(false);
  const [file, setFile] = useState(null);
  const [checking, setChecking] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    client.get("/experiments").then(({ data }) => setExperiments(data));
  }, []);

  const modelOptions = experiments.flatMap((exp) =>
    exp.model_versions.map((mv) => ({ id: mv.id, label: `${exp.name} — ${mv.algorithm}` }))
  );

  async function loadReports(modelVersionId) {
    if (!modelVersionId) return;
    setLoadingReports(true);
    const { data } = await client.get(`/drift/${modelVersionId}/reports`);
    setReports(data);
    setLoadingReports(false);
  }

  useEffect(() => {
    loadReports(selectedModelId);
  }, [selectedModelId]);

  async function handleCheckDrift(e) {
    e.preventDefault();
    if (!file || !selectedModelId) return;
    setChecking(true);
    try {
      const text = await file.text();
      const records = parseCsv(text);
      const { data } = await client.post(`/drift/${selectedModelId}/check`, { records });
      showToast(
        data.is_drifted ? "Drift detected — retraining recommended" : "No significant drift detected",
        data.is_drifted ? "error" : "success"
      );
      await loadReports(selectedModelId);
      setFile(null);
    } catch (err) {
      showToast(err.response?.data?.detail || "Drift check failed", "error");
    } finally {
      setChecking(false);
    }
  }

  const chartData = [...reports]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((r, i) => ({
      index: i + 1,
      score: r.overall_drift_score,
      date: new Date(r.created_at).toLocaleString(),
    }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Drift monitoring</h2>
          <p>Compare new data batches against the training distribution using PSI and the KS-test.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Select a model version</h3>
        <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
          <option value="">Select a model version</option>
          {modelOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>

        {selectedModelId && (
          <form onSubmit={handleCheckDrift} className="upload-form" style={{ marginTop: 14 }}>
            <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} />
            <button type="submit" disabled={!file || checking}>
              {checking ? "Checking..." : "Check new data for drift"}
            </button>
          </form>
        )}
      </div>

      {!selectedModelId ? (
        <EmptyState icon="△" title="Pick a model to monitor" description="Choose a trained model version above to view or run drift checks." />
      ) : loadingReports ? (
        <Skeleton height={200} />
      ) : reports.length === 0 ? (
        <EmptyState icon="📊" title="No drift checks yet" description="Upload a batch of new data above to run the first check." />
      ) : (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="card-title">Drift score over time</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="index" label={{ value: "Check #", position: "insideBottom", offset: -4 }} />
                <YAxis />
                <Tooltip labelFormatter={(i) => chartData[i - 1]?.date} />
                <ReferenceLine y={DRIFT_THRESHOLD} stroke="#dc2626" strokeDasharray="4 4" label="threshold" />
                <Line type="monotone" dataKey="score" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="table-wrap">
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
        </>
      )}
    </div>
  );
}

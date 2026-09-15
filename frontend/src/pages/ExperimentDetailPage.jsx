import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import client from "../api/client.js";
import Skeleton from "../components/Skeleton.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { useToast } from "../context/ToastContext.jsx";

const CHART_COLORS = ["#4f46e5", "#a855f7", "#16a34a", "#f97316"];

export default function ExperimentDetailPage() {
  const { experimentId } = useParams();
  const [experiment, setExperiment] = useState(null);
  const [explanations, setExplanations] = useState({});
  const [loadingExplain, setLoadingExplain] = useState(null);
  const { showToast } = useToast();

  async function load() {
    const { data } = await client.get(`/experiments/${experimentId}`);
    setExperiment(data);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [experimentId]);

  async function handleDeploy(modelVersionId) {
    try {
      await client.post(`/experiments/${experimentId}/model-versions/${modelVersionId}/deploy`);
      showToast("Model deployed", "success");
      await load();
    } catch {
      showToast("Could not deploy model", "error");
    }
  }

  async function handleExplain(modelVersionId) {
    setLoadingExplain(modelVersionId);
    try {
      const { data } = await client.get(`/experiments/${experimentId}/model-versions/${modelVersionId}/explain`);
      setExplanations((prev) => ({ ...prev, [modelVersionId]: data }));
    } catch {
      showToast("Could not compute SHAP explanation", "error");
    } finally {
      setLoadingExplain(null);
    }
  }

  const metricsChartData = useMemo(() => {
    if (!experiment) return [];
    const metricKeys = new Set();
    experiment.model_versions.forEach((mv) => Object.keys(mv.metrics || {}).forEach((k) => metricKeys.add(k)));
    return Array.from(metricKeys).map((key) => {
      const row = { metric: key };
      experiment.model_versions.forEach((mv) => {
        row[mv.algorithm] = mv.metrics?.[key] ?? 0;
      });
      return row;
    });
  }, [experiment]);

  if (!experiment) return <Skeleton height={220} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>{experiment.name}</h2>
          <p>
            <StatusPill status={experiment.status} />
            {experiment.error_message && <span className="error"> — {experiment.error_message}</span>}
          </p>
        </div>
        <Link to="/experiments" className="link-button">← Back to experiments</Link>
      </div>

      {experiment.status === "running" && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="muted" style={{ marginBottom: 8 }}>Training in progress...</div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: "60%" }} />
          </div>
        </div>
      )}

      {experiment.model_versions.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="card-title">Metric comparison</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={metricsChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="metric" />
              <YAxis />
              <Tooltip />
              <Legend />
              {experiment.model_versions.map((mv, i) => (
                <Bar key={mv.id} dataKey={mv.algorithm} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card">
        <h3 className="card-title">Model versions</h3>
        <div className="table-wrap" style={{ border: "none" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Algorithm</th>
                <th>Metrics</th>
                <th>Deployed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {experiment.model_versions.map((mv) => (
                <tr key={mv.id}>
                  <td style={{ fontWeight: 600 }}>{mv.algorithm}</td>
                  <td>
                    <div className="metric-chip-row">
                      {mv.metrics &&
                        Object.entries(mv.metrics).map(([k, v]) => (
                          <span className="metric-chip" key={k}>
                            {k}: {typeof v === "number" ? v.toFixed(4) : v}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td>
                    {mv.is_deployed ? (
                      <span className="badge badge-ok">Deployed</span>
                    ) : (
                      <span className="badge badge-neutral">Not deployed</span>
                    )}
                  </td>
                  <td className="row-actions">
                    <button className="btn-secondary btn-sm" onClick={() => handleDeploy(mv.id)} disabled={mv.is_deployed}>
                      Deploy
                    </button>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleExplain(mv.id)}
                      disabled={loadingExplain === mv.id}
                    >
                      {loadingExplain === mv.id ? "Computing..." : "Explain (SHAP)"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {Object.entries(explanations).map(([modelVersionId, explanation]) => (
        <ExplanationPanel key={modelVersionId} explanation={explanation} />
      ))}
    </div>
  );
}

function ExplanationPanel({ explanation }) {
  const chartData = explanation.feature_names
    .map((name, i) => ({ name, importance: explanation.feature_importance[i] }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 15);

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 className="card-title">
        Feature importance — {explanation.algorithm} <span className="muted">(mean |SHAP value|)</span>
      </h3>
      <ResponsiveContainer width="100%" height={Math.max(240, chartData.length * 28)}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" />
          <YAxis type="category" dataKey="name" width={160} />
          <Tooltip />
          <Bar dataKey="importance" fill="#4f46e5" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

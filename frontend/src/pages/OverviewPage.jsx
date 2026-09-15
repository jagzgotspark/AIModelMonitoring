import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client.js";
import EmptyState from "../components/EmptyState.jsx";
import Skeleton from "../components/Skeleton.jsx";
import StatusPill from "../components/StatusPill.jsx";

export default function OverviewPage() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client
      .get("/dashboard/summary")
      .then(({ data }) => setSummary(data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <div className="stat-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div className="stat-card" key={i}>
              <Skeleton width={80} height={12} />
              <Skeleton width={50} height={26} style={{ marginTop: 10 }} />
            </div>
          ))}
        </div>
        <Skeleton height={220} />
      </div>
    );
  }

  const stats = [
    { label: "Datasets", value: summary.dataset_count, hint: "uploaded", to: "/datasets" },
    { label: "Experiments", value: summary.experiment_count, hint: `${summary.running_experiment_count} running`, to: "/experiments" },
    { label: "Model versions", value: summary.model_version_count, hint: "trained", to: "/experiments" },
    { label: "Deployed models", value: summary.deployed_model_count, hint: "in production", to: "/experiments" },
  ];

  return (
    <div>
      <div className="stat-grid">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="stat-card" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-hint">{s.hint}</div>
          </Link>
        ))}
      </div>

      <div className="two-col">
        <div className="card">
          <h3 className="card-title">Recent experiments</h3>
          {summary.recent_experiments.length === 0 ? (
            <EmptyState
              icon="⚙"
              title="No experiments yet"
              description="Upload a dataset and kick off your first training run."
              action={<Link to="/datasets"><button>Go to datasets</button></Link>}
            />
          ) : (
            <div className="table-wrap" style={{ border: "none" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Models</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent_experiments.map((e) => (
                    <tr key={e.id}>
                      <td><Link to={`/experiments/${e.id}`}>{e.name}</Link></td>
                      <td><StatusPill status={e.status} /></td>
                      <td>{e.model_version_count}</td>
                      <td>{new Date(e.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="card-title">Drift alerts</h3>
          {summary.recent_drift_alerts.length === 0 ? (
            <EmptyState icon="✓" title="No drift detected" description="Everything monitored is within expected distribution." />
          ) : (
            summary.recent_drift_alerts.map((a) => (
              <div key={a.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{a.experiment_name} — {a.algorithm}</div>
                <div className="muted">
                  drift score {a.overall_drift_score.toFixed(3)} · {new Date(a.created_at).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

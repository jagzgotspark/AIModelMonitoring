import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client.js";
import EmptyState from "../components/EmptyState.jsx";
import Skeleton from "../components/Skeleton.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { useToast } from "../context/ToastContext.jsx";

const ALGORITHMS = [
  { id: "random_forest", label: "Random Forest" },
  { id: "xgboost", label: "XGBoost" },
];

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [algorithms, setAlgorithms] = useState(ALGORITHMS.map((a) => a.id));
  const [tune, setTune] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  async function loadData() {
    const [expRes, dsRes] = await Promise.all([client.get("/experiments"), client.get("/datasets")]);
    setExperiments(expRes.data);
    setDatasets(dsRes.data.filter((d) => d.target_column));
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 4000);
    return () => clearInterval(interval);
  }, []);

  function toggleAlgorithm(algo) {
    setAlgorithms((prev) => (prev.includes(algo) ? prev.filter((a) => a !== algo) : [...prev, algo]));
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!algorithms.length) {
      showToast("Select at least one algorithm", "error");
      return;
    }
    setSubmitting(true);
    try {
      await client.post("/experiments", {
        dataset_id: datasetId,
        name,
        algorithms,
        tune_hyperparameters: tune,
      });
      showToast("Training started", "success");
      setName("");
      setDatasetId("");
      await loadData();
    } catch (err) {
      showToast(err.response?.data?.detail || "Could not create experiment", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    try {
      await client.delete(`/experiments/${id}`);
      showToast("Experiment deleted", "success");
      await loadData();
    } catch {
      showToast("Could not delete experiment", "error");
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Experiments</h2>
          <p>Train and compare models, then deploy the best one.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">New experiment</h3>
        {datasets.length === 0 ? (
          <p className="muted">
            No datasets with a target column yet. <Link to="/datasets">Upload a dataset</Link> and set its target
            column first.
          </p>
        ) : (
          <form onSubmit={handleCreate} className="experiment-form">
            <input placeholder="Experiment name" value={name} onChange={(e) => setName(e.target.value)} required />
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} required>
              <option value="" disabled>
                Select dataset
              </option>
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.task_type})
                </option>
              ))}
            </select>
            <div className="algo-checkboxes">
              {ALGORITHMS.map((algo) => (
                <label key={algo.id}>
                  <input
                    type="checkbox"
                    checked={algorithms.includes(algo.id)}
                    onChange={() => toggleAlgorithm(algo.id)}
                  />
                  {algo.label}
                </label>
              ))}
            </div>
            <label className="checkbox-row">
              <input type="checkbox" checked={tune} onChange={(e) => setTune(e.target.checked)} />
              Tune hyperparameters
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? "Starting..." : "Run training"}
            </button>
          </form>
        )}
      </div>

      {loading ? (
        <Skeleton height={160} />
      ) : experiments.length === 0 ? (
        <EmptyState icon="⚙" title="No experiments yet" description="Create one above once you have a dataset ready." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Task type</th>
                <th>Models</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((exp) => (
                <tr key={exp.id}>
                  <td>
                    <Link to={`/experiments/${exp.id}`}>{exp.name}</Link>
                  </td>
                  <td><StatusPill status={exp.status} /></td>
                  <td>{exp.task_type || "—"}</td>
                  <td>{exp.model_versions.length}</td>
                  <td>{new Date(exp.created_at).toLocaleString()}</td>
                  <td className="row-actions">
                    <button className="btn-danger btn-sm" onClick={() => handleDelete(exp.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

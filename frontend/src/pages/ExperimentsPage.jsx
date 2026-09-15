import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client.js";

const ALGORITHMS = ["random_forest", "xgboost"];

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [name, setName] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [algorithms, setAlgorithms] = useState(ALGORITHMS);
  const [tune, setTune] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    const [expRes, dsRes] = await Promise.all([client.get("/experiments"), client.get("/datasets")]);
    setExperiments(expRes.data);
    setDatasets(dsRes.data.filter((d) => d.target_column));
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
    setError("");
    try {
      await client.post("/experiments", {
        dataset_id: datasetId,
        name,
        algorithms,
        tune_hyperparameters: tune,
      });
      setName("");
      await loadData();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not create experiment");
    }
  }

  return (
    <div>
      <h2>Experiments</h2>
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
            <label key={algo}>
              <input type="checkbox" checked={algorithms.includes(algo)} onChange={() => toggleAlgorithm(algo)} />
              {algo}
            </label>
          ))}
        </div>
        <label>
          <input type="checkbox" checked={tune} onChange={(e) => setTune(e.target.checked)} />
          Tune hyperparameters
        </label>
        <button type="submit">Run training</button>
      </form>
      {error && <p className="error">{error}</p>}

      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Task type</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {experiments.map((exp) => (
            <tr key={exp.id}>
              <td>
                <Link to={`/experiments/${exp.id}`}>{exp.name}</Link>
              </td>
              <td className={`status status-${exp.status}`}>{exp.status}</td>
              <td>{exp.task_type}</td>
              <td>{new Date(exp.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

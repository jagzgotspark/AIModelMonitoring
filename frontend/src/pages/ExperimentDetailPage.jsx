import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import client from "../api/client.js";

export default function ExperimentDetailPage() {
  const { experimentId } = useParams();
  const [experiment, setExperiment] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [selectedModelId, setSelectedModelId] = useState(null);

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
    await client.post(`/experiments/${experimentId}/model-versions/${modelVersionId}/deploy`);
    await load();
  }

  async function handleExplain(modelVersionId) {
    setSelectedModelId(modelVersionId);
    setExplanation(null);
    const { data } = await client.get(`/experiments/${experimentId}/model-versions/${modelVersionId}/explain`);
    setExplanation(data);
  }

  if (!experiment) return <p>Loading...</p>;

  const chartData = explanation
    ? explanation.feature_names
        .map((name, i) => ({ name, importance: explanation.feature_importance[i] }))
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 15)
    : [];

  return (
    <div>
      <h2>{experiment.name}</h2>
      <p>
        Status: <span className={`status status-${experiment.status}`}>{experiment.status}</span>
        {experiment.error_message && <span className="error"> — {experiment.error_message}</span>}
      </p>

      <h3>Model comparison</h3>
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
              <td>{mv.algorithm}</td>
              <td>
                {mv.metrics &&
                  Object.entries(mv.metrics)
                    .map(([k, v]) => `${k}: ${v.toFixed ? v.toFixed(4) : v}`)
                    .join(", ")}
              </td>
              <td>{mv.is_deployed ? "Yes" : "No"}</td>
              <td>
                <button onClick={() => handleDeploy(mv.id)}>Deploy</button>
                <button onClick={() => handleExplain(mv.id)}>Explain (SHAP)</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedModelId && (
        <div className="explanation-panel">
          <h3>Feature importance (mean |SHAP value|)</h3>
          {!explanation ? (
            <p>Computing explanation...</p>
          ) : (
            <BarChart width={700} height={400} data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={150} />
              <Tooltip />
              <Bar dataKey="importance" fill="#4f7cff" />
            </BarChart>
          )}
        </div>
      )}
    </div>
  );
}

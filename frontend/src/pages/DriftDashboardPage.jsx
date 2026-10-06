import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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

// Series colors (validated for colour-blind separation): orange = current / overall, blue = reference / compared feature.
const CURRENT_COLOR = "#b1440e";
const REFERENCE_COLOR = "#3a6ea5";

// Status colors are reserved for drift severity and always shown next to a text label.
const SEVERITY = {
  significant: { label: "Drifted", color: "#a3291f", badge: "badge-danger" },
  moderate: { label: "Moderate", color: "#92650a", badge: "badge-warning" },
  none: { label: "Stable", color: "#3c6e42", badge: "badge-ok" },
};

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
        if (raw === undefined || raw === "") record[h] = null;
        else record[h] = Number.isNaN(num) ? raw : num;
      });
      return record;
    });
}

const fmt = (v, digits = 3) => (typeof v === "number" ? Number(v.toPrecision(digits)).toLocaleString() : "—");
// Legend text stays in the text colour; the marker beside it carries the series colour.
const legendText = (value) => <span style={{ color: "var(--text)" }}>{value}</span>;

const pct = (v) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—");

// Reports saved before per-feature details were recorded only carry psi / is_drifted.
function severityOf(feature) {
  if (feature.severity) return feature.severity;
  if (feature.is_drifted) return "significant";
  return feature.psi > 0.1 ? "moderate" : "none";
}

function driftedFeatures(report) {
  return Object.entries(report.feature_drift || {})
    .filter(([, f]) => f.is_drifted)
    .sort((a, b) => b[1].psi - a[1].psi)
    .map(([name]) => name);
}

// Plain-language list of what changed in one feature between training data and the new batch.
function describeChanges(feature) {
  if (!feature.type) return ["Details not recorded for this check — run a new check to see them."];
  const changes = [];
  if (feature.type === "numeric") {
    const { mean: before } = feature.reference;
    const { mean: after } = feature.current;
    const change = before !== 0 ? ((after - before) / Math.abs(before)) * 100 : null;
    if (change === null || Math.abs(change) >= 1) {
      const dir = after > before ? "rose" : "fell";
      changes.push(`Average ${dir}${change === null ? "" : ` ${Math.abs(change).toFixed(1)}%`} (${fmt(before)} → ${fmt(after)})`);
    } else {
      changes.push(`Average unchanged (${fmt(before)} → ${fmt(after)})`);
    }
    const spreadBefore = feature.reference.std;
    const spreadAfter = feature.current.std;
    if (spreadBefore > 0 && Math.abs(spreadAfter - spreadBefore) / spreadBefore >= 0.25) {
      changes.push(`Spread ${spreadAfter > spreadBefore ? "widened" : "narrowed"} (std ${fmt(spreadBefore)} → ${fmt(spreadAfter)})`);
    }
    if (feature.current.min < feature.reference.min || feature.current.max > feature.reference.max) {
      changes.push(`Values outside training range (${fmt(feature.current.min)} to ${fmt(feature.current.max)})`);
    }
  } else {
    const byLabel = Object.fromEntries(feature.distribution.map((d) => [d.label, d]));
    feature.new_categories.forEach((c) => changes.push(`New category "${c}" (${pct(byLabel[c]?.current_pct)} of new data)`));
    feature.missing_categories.forEach((c) => changes.push(`"${c}" no longer appears (was ${pct(byLabel[c]?.reference_pct)})`));
    const shifted = feature.distribution
      .filter((d) => d.reference_pct > 0 && d.current_pct > 0)
      .map((d) => ({ ...d, delta: d.current_pct - d.reference_pct }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    if (shifted && Math.abs(shifted.delta) >= 0.05) {
      changes.push(`"${shifted.label}" share ${pct(shifted.reference_pct)} → ${pct(shifted.current_pct)}`);
    }
    if (changes.length === 0) changes.push("Category mix unchanged");
  }
  const missingDelta = feature.current_missing_pct - feature.reference_missing_pct;
  if (Math.abs(missingDelta) >= 0.05) {
    changes.push(`Missing values ${pct(feature.reference_missing_pct)} → ${pct(feature.current_missing_pct)}`);
  }
  return changes;
}

export default function DriftDashboardPage() {
  const [experiments, setExperiments] = useState([]);
  const [loadingExperiments, setLoadingExperiments] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [file, setFile] = useState(null);
  const [checking, setChecking] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [compareFeature, setCompareFeature] = useState("");
  const { showToast } = useToast();

  useEffect(() => {
    client
      .get("/experiments")
      .then(({ data }) => setExperiments(data))
      .finally(() => setLoadingExperiments(false));
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
    return data;
  }

  useEffect(() => {
    setSelectedReportId(null);
    setCompareFeature("");
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
      setSelectedReportId(data.id);
      setFile(null);
    } catch (err) {
      showToast(err.response?.data?.detail || "Drift check failed", "error");
    } finally {
      setChecking(false);
    }
  }

  // Reports arrive newest first; the chart reads oldest → newest.
  const chronological = useMemo(
    () => [...reports].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    [reports]
  );
  const selectedReport = reports.find((r) => r.id === selectedReportId) || reports[0];

  const featureNames = useMemo(() => {
    const names = [];
    chronological.forEach((r) => Object.keys(r.feature_drift || {}).forEach((n) => !names.includes(n) && names.push(n)));
    return names;
  }, [chronological]);

  // Default the compared feature to whichever moved most in the latest check.
  const activeCompare =
    compareFeature === "none"
      ? ""
      : compareFeature ||
        Object.entries(reports[0]?.feature_drift || {}).sort((a, b) => b[1].psi - a[1].psi)[0]?.[0] ||
        "";

  const chartData = chronological.map((r, i) => ({
    index: i + 1,
    id: r.id,
    score: r.overall_drift_score,
    feature: r.feature_drift?.[activeCompare]?.psi ?? null,
    isDrifted: r.is_drifted,
    drifted: driftedFeatures(r),
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
        {loadingExperiments ? (
          <Skeleton width={260} height={36} />
        ) : modelOptions.length === 0 ? (
          <EmptyState
            icon="⚙"
            title="No trained models yet"
            description="Drift monitoring needs at least one completed experiment with a trained model version. Run an experiment first, then come back here."
            action={<Link to="/experiments"><button>Go to experiments</button></Link>}
          />
        ) : (
          <>
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
          </>
        )}
      </div>

      {modelOptions.length === 0 ? null : !selectedModelId ? (
        <EmptyState icon="△" title="Pick a model to monitor" description="Choose a trained model version above to view or run drift checks." />
      ) : loadingReports ? (
        <Skeleton height={200} />
      ) : reports.length === 0 ? (
        <EmptyState icon="📊" title="No drift checks yet" description="Upload a batch of new data above to run the first check." />
      ) : (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header-row">
              <h3 className="card-title">Drift score over time</h3>
              <label className="inline-control">
                Compare feature
                <select value={compareFeature || activeCompare} onChange={(e) => setCompareFeature(e.target.value)}>
                  <option value="none">None</option>
                  {featureNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted chart-note">
              Overall score is the average PSI across features; above {DRIFT_THRESHOLD} is significant. Red points are checks
              flagged for drift — click a point to inspect it below.
              {chronological.length === 1 && " Only one check so far — run more checks to see a trend."}
            </p>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart
                data={chartData}
                margin={{ top: 10, right: 24, left: 0, bottom: 10 }}
                onClick={(state) => state?.activePayload && setSelectedReportId(state.activePayload[0].payload.id)}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="index" label={{ value: "Check #", position: "insideBottom", offset: -6 }} />
                <YAxis />
                <Tooltip content={<TrendTooltip compareFeature={activeCompare} />} />
                <Legend verticalAlign="top" height={28} formatter={legendText} />
                {/* extendDomain keeps the threshold visible even when every check is far below it. */}
                <ReferenceLine
                  y={DRIFT_THRESHOLD}
                  stroke={SEVERITY.significant.color}
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{ value: `threshold ${DRIFT_THRESHOLD}`, position: "insideTopRight", fill: "var(--text-muted)", fontSize: 12 }}
                />
                <Line
                  name="Overall drift score"
                  type="linear"
                  dataKey="score"
                  stroke={CURRENT_COLOR}
                  strokeWidth={2}
                  isAnimationActive={false}
                  dot={({ key, ...props }) => <CheckDot key={key} {...props} selectedId={selectedReport?.id} />}
                  activeDot={{ r: 6 }}
                />
                {activeCompare && (
                  <Line
                    name={`${activeCompare} PSI`}
                    type="linear"
                    dataKey="feature"
                    stroke={REFERENCE_COLOR}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    isAnimationActive={false}
                    connectNulls
                    dot={{ r: 4, fill: REFERENCE_COLOR, stroke: "var(--surface)", strokeWidth: 2 }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <DriftDetails
            reports={reports}
            report={selectedReport}
            onSelectReport={setSelectedReportId}
          />

          <div className="table-wrap" style={{ marginTop: 20 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Checked at</th>
                  <th>Samples</th>
                  <th>Drift score</th>
                  <th>Drifted features</th>
                  <th>Alert</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr
                    key={r.id}
                    className={`clickable-row${r.id === selectedReport?.id ? " is-selected" : ""}`}
                    onClick={() => setSelectedReportId(r.id)}
                  >
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td>{r.n_samples}</td>
                    <td>{r.overall_drift_score.toFixed(4)}</td>
                    <td>{driftedFeatures(r).join(", ") || <span className="muted">none</span>}</td>
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

function CheckDot({ cx, cy, payload, index, selectedId }) {
  if (cx == null || cy == null) return null;
  const selected = payload.id === selectedId;
  return (
    <g key={index}>
      {selected && <circle cx={cx} cy={cy} r={9} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} />}
      <circle
        cx={cx}
        cy={cy}
        r={payload.isDrifted ? 6 : 4}
        fill={payload.isDrifted ? SEVERITY.significant.color : CURRENT_COLOR}
        stroke="var(--surface)"
        strokeWidth={2}
      />
    </g>
  );
}

function TrendTooltip({ active, payload, compareFeature }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">
        Check #{point.index} · {point.date}
      </div>
      <div>
        Overall score: <strong>{point.score.toFixed(3)}</strong>{" "}
        <span className={`badge ${point.isDrifted ? "badge-danger" : "badge-ok"}`}>{point.isDrifted ? "Drifted" : "Stable"}</span>
      </div>
      {compareFeature && point.feature != null && (
        <div>
          {compareFeature} PSI: <strong>{point.feature.toFixed(3)}</strong>
        </div>
      )}
      <div className="muted">Drifted features: {point.drifted.join(", ") || "none"}</div>
    </div>
  );
}

function DriftDetails({ reports, report, onSelectReport }) {
  const [selectedFeature, setSelectedFeature] = useState("");

  const features = useMemo(
    () =>
      Object.entries(report.feature_drift || {})
        .map(([name, f]) => ({ name, ...f, severity: severityOf(f) }))
        .sort((a, b) => Number(b.is_drifted) - Number(a.is_drifted) || b.psi - a.psi),
    [report]
  );

  useEffect(() => setSelectedFeature(""), [report.id]);

  const drifted = features.filter((f) => f.is_drifted);
  const focus = features.find((f) => f.name === selectedFeature) || features[0];
  const psiChartData = features.map((f) => ({ name: f.name, psi: f.psi, severity: f.severity }));

  return (
    <div className="card">
      <div className="card-header-row">
        <h3 className="card-title">What drifted</h3>
        <label className="inline-control">
          Check
          <select value={report.id} onChange={(e) => onSelectReport(e.target.value)}>
            {reports.map((r, i) => (
              <option key={r.id} value={r.id}>
                #{reports.length - i} · {new Date(r.created_at).toLocaleString()} · {r.is_drifted ? "drifted" : "stable"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={`drift-verdict ${report.is_drifted ? "is-drifted" : "is-stable"}`}>
        <strong>{report.is_drifted ? "⚠ Drift detected — retraining recommended." : "✓ No significant drift."}</strong>{" "}
        {drifted.length > 0
          ? `${drifted.length} of ${features.length} features changed significantly: ${drifted.map((f) => f.name).join(", ")}.`
          : `All ${features.length} features are within normal range of the training data.`}
      </div>

      <div className="stat-grid" style={{ marginTop: 16 }}>
        <StatTile label="Features drifted" value={`${drifted.length} / ${features.length}`} />
        <StatTile label="Overall drift score" value={report.overall_drift_score.toFixed(3)} hint={`threshold ${DRIFT_THRESHOLD}`} />
        <StatTile label="Samples checked" value={report.n_samples ?? "—"} />
        <StatTile
          label="Most drifted feature"
          value={features[0]?.name ?? "—"}
          hint={features[0] ? `PSI ${features[0].psi.toFixed(3)}` : undefined}
        />
      </div>

      <h4 className="section-subtitle">Drift by feature (PSI)</h4>
      <div className="legend-row">
        {Object.entries(SEVERITY).map(([key, s]) => (
          <span key={key} className="legend-item">
            <span className="legend-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={Math.max(160, psiChartData.length * 40 + 40)}>
        <BarChart data={psiChartData} layout="vertical" margin={{ left: 20, right: 30 }} barCategoryGap={8}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" />
          <YAxis type="category" dataKey="name" width={130} />
          <Tooltip
            formatter={(value, _name, item) => [`${value.toFixed(3)} (${SEVERITY[item.payload.severity].label})`, "PSI"]}
            cursor={{ fill: "var(--surface-alt)" }}
          />
          <ReferenceLine x={DRIFT_THRESHOLD} stroke={SEVERITY.significant.color} strokeDasharray="4 4" ifOverflow="extendDomain" />
          <Bar
            dataKey="psi"
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            onClick={(d) => setSelectedFeature(d.name)}
            style={{ cursor: "pointer" }}
          >
            {psiChartData.map((d) => (
              <Cell key={d.name} fill={SEVERITY[d.severity].color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <h4 className="section-subtitle">What changed in each feature</h4>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Type</th>
              <th>PSI</th>
              <th>KS stat / p-value</th>
              <th>Status</th>
              <th>What changed</th>
            </tr>
          </thead>
          <tbody>
            {features.map((f) => (
              <tr
                key={f.name}
                className={`clickable-row${f.name === focus?.name ? " is-selected" : ""}`}
                onClick={() => setSelectedFeature(f.name)}
              >
                <td style={{ fontWeight: 600 }}>{f.name}</td>
                <td className="muted">{f.type ?? "—"}</td>
                <td>{f.psi.toFixed(3)}</td>
                <td>{f.ks_statistic != null ? `${f.ks_statistic.toFixed(3)} / ${f.p_value.toExponential(1)}` : "—"}</td>
                <td>
                  <span className={`badge ${SEVERITY[f.severity].badge}`}>{SEVERITY[f.severity].label}</span>
                </td>
                <td>
                  <ul className="change-list">
                    {describeChanges(f).map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {focus && <FeatureComparison feature={focus} />}
    </div>
  );
}

function StatTile({ label, value, hint }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function FeatureComparison({ feature }) {
  if (!feature.distribution) {
    return (
      <p className="muted" style={{ marginTop: 16 }}>
        Distribution details weren't recorded for this check. Run a new check to compare {feature.name} against the training data.
      </p>
    );
  }

  const data = feature.distribution.map((d) => ({
    label: d.label,
    reference: d.reference_pct * 100,
    current: d.current_pct * 100,
  }));
  const stats =
    feature.type === "numeric"
      ? [
          ["Average", fmt(feature.reference.mean), fmt(feature.current.mean)],
          ["Median", fmt(feature.reference.median), fmt(feature.current.median)],
          ["Std deviation", fmt(feature.reference.std), fmt(feature.current.std)],
          ["Min", fmt(feature.reference.min), fmt(feature.current.min)],
          ["Max", fmt(feature.reference.max), fmt(feature.current.max)],
          ["Missing values", pct(feature.reference_missing_pct), pct(feature.current_missing_pct)],
        ]
      : [
          ["Most common", feature.reference_top, feature.current_top],
          ["New categories", "—", feature.new_categories.join(", ") || "none"],
          ["Categories gone", feature.missing_categories.join(", ") || "none", "—"],
          ["Missing values", pct(feature.reference_missing_pct), pct(feature.current_missing_pct)],
        ];

  return (
    <div className="feature-comparison">
      <h4 className="section-subtitle">
        {feature.name}: training data vs new data{" "}
        <span className={`badge ${SEVERITY[feature.severity].badge}`}>{SEVERITY[feature.severity].label}</span>
      </h4>
      <p className="muted chart-note">
        {feature.type === "numeric"
          ? "Share of rows in each range. Ranges are the training data's deciles, so each holds about 10% of training rows."
          : "Share of rows in each category (top categories shown)."}
      </p>
      <div className="two-col">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 40 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" angle={-30} textAnchor="end" interval={0} height={60} fontSize={11} />
            <YAxis tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v) => `${v.toFixed(1)}%`} cursor={{ fill: "var(--surface-alt)" }} />
            <Legend verticalAlign="top" height={28} formatter={legendText} />
            <Bar name="Training data" dataKey="reference" fill={REFERENCE_COLOR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar name="New data" dataKey="current" fill={CURRENT_COLOR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        <table className="data-table compact-table">
          <thead>
            <tr>
              <th />
              <th>Training</th>
              <th>New</th>
            </tr>
          </thead>
          <tbody>
            {stats.map(([label, before, after]) => (
              <tr key={label}>
                <td className="muted">{label}</td>
                <td>{before}</td>
                <td style={{ fontWeight: before !== after ? 600 : 400 }}>{after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

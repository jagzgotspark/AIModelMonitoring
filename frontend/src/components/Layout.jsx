import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const NAV_ITEMS = [
  { to: "/", icon: "▦", label: "Overview", end: true },
  { to: "/datasets", icon: "↑", label: "Datasets" },
  { to: "/experiments", icon: "⚙", label: "Experiments" },
  { to: "/drift", icon: "△", label: "Drift" },
];

const TITLES = {
  "/": ["Overview", "Your models and monitoring at a glance"],
  "/datasets": ["Datasets", "Upload data and configure training targets"],
  "/experiments": ["Experiments", "Train, compare, and deploy models"],
  "/drift": ["Drift monitoring", "Track incoming data against training distributions"],
};

export default function Layout() {
  const { logout, email } = useAuth();
  const location = useLocation();

  const matchedKey = Object.keys(TITLES)
    .filter((key) => key === "/" ? location.pathname === "/" : location.pathname.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  const [title, subtitle] = TITLES[matchedKey] || ["", ""];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">◈</span>
          AI Monitor
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-user" title={email}>{email}</span>
          <button onClick={logout} className="btn-sm">Log out</button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <div className="topbar-sub">{subtitle}</div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

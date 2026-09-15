import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Layout() {
  const { logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>AI Model Monitoring</h1>
        <nav>
          <NavLink to="/datasets">Datasets</NavLink>
          <NavLink to="/experiments">Experiments</NavLink>
          <NavLink to="/drift">Drift</NavLink>
        </nav>
        <button onClick={logout}>Log out</button>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

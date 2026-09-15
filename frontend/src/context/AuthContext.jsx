import { createContext, useContext, useEffect, useState } from "react";
import client from "../api/client.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem("access_token"));
  const [email, setEmail] = useState(null);

  useEffect(() => {
    if (!token) {
      setEmail(null);
      return;
    }
    client
      .get("/auth/me")
      .then(({ data }) => setEmail(data.email))
      .catch(() => {
        localStorage.removeItem("access_token");
        setToken(null);
      });
  }, [token]);

  async function login(email, password) {
    const form = new URLSearchParams();
    form.append("username", email);
    form.append("password", password);
    const { data } = await client.post("/auth/login", form, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    localStorage.setItem("access_token", data.access_token);
    setToken(data.access_token);
  }

  async function register(email, password, fullName) {
    await client.post("/auth/register", {
      email,
      password,
      full_name: fullName,
    });
    await login(email, password);
  }

  function logout() {
    localStorage.removeItem("access_token");
    setToken(null);
  }

  return (
    <AuthContext.Provider value={{ token, email, login, register, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Login from "./pages/Login";
import Prices from "./pages/Prices";

export default function App() {
  const { loading, session, profile, signOut } = useAuth();

  if (loading) {
    return <p className="p-8 text-center text-slate-500">Duke u ngarkuar…</p>;
  }
  if (!session) return <Login />;
  if (!profile) {
    return (
      <div className="p-8 text-center space-y-4">
        <p>Kjo llogari nuk është aktive.</p>
        <button onClick={signOut} className="px-4 py-2 rounded-lg bg-navy text-white">
          Dil
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
          <span className="font-bold">
            Pristine <span className="text-orange">Laundry Care</span>
          </span>
          <span className="ml-auto text-sm">
            {profile.full_name} · {profile.role === "admin" ? "Pronar" : "Punëtor"}
          </span>
          <button onClick={signOut} className="text-sm underline">
            Dil
          </button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-4">
        <Routes>
          <Route path="/" element={<Prices />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

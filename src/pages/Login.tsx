import { useEffect, useState, type FormEvent } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type Worker = { id: string; full_name: string };

export default function Login() {
  const [tab, setTab] = useState<"worker" | "admin">("worker");

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow p-6">
        <h1 className="text-2xl font-bold text-navy text-center">Pristine Laundry Care</h1>
        <p className="text-center text-slate-500 mb-6">Hyrja në sistem</p>

        <div className="grid grid-cols-2 gap-2 mb-6">
          <TabButton active={tab === "worker"} onClick={() => setTab("worker")}>Punëtor</TabButton>
          <TabButton active={tab === "admin"} onClick={() => setTab("admin")}>Pronar</TabButton>
        </div>

        {tab === "worker" ? <WorkerLogin /> : <AdminLogin />}
      </div>
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`py-2 rounded-lg font-medium ${
        props.active ? "bg-navy text-white" : "bg-slate-100 text-slate-700"
      }`}
    >
      {props.children}
    </button>
  );
}

function WorkerLogin() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selected, setSelected] = useState<Worker | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc("login_workers").then(({ data }) => setWorkers((data as Worker[]) ?? []));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");

    const { data, error } = await supabase.functions.invoke("pin-login", {
      body: { user_id: selected.id, pin },
    });
    if (error) {
      let message = "Hyrja dështoi";
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        if (body?.error) message = body.error;
      }
      setError(message);
      setPin("");
      setBusy(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash,
      type: "magiclink",
    });
    if (verifyError) setError("Hyrja dështoi");
    setBusy(false);
  }

  if (!selected) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">Zgjidhni emrin tuaj:</p>
        {workers.map((w) => (
          <button
            key={w.id}
            onClick={() => setSelected(w)}
            className="w-full py-3 rounded-lg border border-slate-300 hover:border-navy text-left px-4"
          >
            {w.full_name}
          </button>
        ))}
        {workers.length === 0 && <p className="text-sm text-slate-400">Nuk ka punëtorë.</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600">
        {selected.full_name} ·{" "}
        <button type="button" className="text-navy underline" onClick={() => setSelected(null)}>
          ndrysho
        </button>
      </p>
      <input
        autoFocus
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        placeholder="PIN"
        className="w-full text-center text-2xl tracking-widest border border-slate-300 rounded-lg py-3"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        disabled={busy || pin.length < 4}
        className="w-full py-3 rounded-lg bg-orange text-white font-semibold disabled:opacity-50"
      >
        Hyr
      </button>
    </form>
  );
}

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });
    if (error) setError("Kodi nuk u dërgua. Kontrolloni email-in.");
    else setCodeSent(true);
    setBusy(false);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    if (error) {
      setError("Kodi është i gabuar ose ka skaduar.");
      setBusy(false);
      return;
    }
    await supabase.rpc("log_my_login", { p_user_agent: navigator.userAgent });
    setBusy(false);
  }

  if (!codeSent) {
    return (
      <form onSubmit={sendCode} className="space-y-4">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full border border-slate-300 rounded-lg px-3 py-3"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="w-full py-3 rounded-lg bg-navy text-white font-semibold disabled:opacity-50">
          Dërgo kodin
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <p className="text-sm text-slate-600">Shkruani kodin që morët në {email}.</p>
      <input
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={8}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        placeholder="Kodi"
        className="w-full text-center text-2xl tracking-widest border border-slate-300 rounded-lg py-3"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy || code.length < 6} className="w-full py-3 rounded-lg bg-navy text-white font-semibold disabled:opacity-50">
        Hyr
      </button>
    </form>
  );
}

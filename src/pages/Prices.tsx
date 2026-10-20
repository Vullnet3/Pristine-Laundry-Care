import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { formatEuro } from "../lib/format";

export type Service = {
  plu: number;
  name_on_list: string;
  item: string;
  category: string;
  service: string;
  line: "Casual" | "Luxury";
  price_eur: number;
  price_type: "fixed" | "per_kg" | "free";
  active: boolean;
};

const PRICE_TYPE_LABEL: Record<Service["price_type"], string> = {
  fixed: "për copë",
  per_kg: "për kg",
  free: "çmim i lirë",
};

// Accepts "2.5" or "2,50"; returns null if it is not a valid price.
function parsePrice(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  if (!Number.isFinite(value) || value < 0 || !/^\d+([.,]\d{1,2})?$/.test(text.trim())) return null;
  return value;
}

export default function Prices() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [services, setServices] = useState<Service[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Service | null>(null);
  const [adding, setAdding] = useState(false);
  const [loadError, setLoadError] = useState("");

  async function load() {
    const { data, error } = await supabase.from("services").select("*").order("plu");
    if (error) setLoadError("Lista e çmimeve nuk u ngarkua.");
    else setServices((data ?? []).map((s) => ({ ...s, price_eur: Number(s.price_eur) })));
  }

  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter(
      (s) =>
        (isAdmin || s.active) &&
        (q === "" || String(s.plu) === q || s.name_on_list.toLowerCase().includes(q)),
    );
  }, [services, search, isAdmin]);

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <h2 className="text-xl font-bold text-navy mr-auto">Lista e çmimeve</h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Kërko me PLU ose emër"
          className="border border-slate-300 rounded-lg px-3 py-2 w-64 max-w-full"
        />
        {isAdmin && (
          <button onClick={() => setAdding(true)} className="px-4 py-2 rounded-lg bg-orange text-white font-medium">
            + Shto shërbim
          </button>
        )}
      </div>

      {loadError && <p className="text-red-600 mb-4">{loadError}</p>}

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">PLU</th>
              <th className="px-3 py-2">Shërbimi</th>
              <th className="px-3 py-2">Linja</th>
              <th className="px-3 py-2 text-right">Çmimi</th>
              {isAdmin && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.plu} className={`border-t border-slate-100 ${s.active ? "" : "text-slate-400"}`}>
                <td className="px-3 py-2 font-mono">{s.plu}</td>
                <td className="px-3 py-2">
                  {s.name_on_list}
                  {!s.active && <span className="ml-2 text-xs">(joaktiv)</span>}
                </td>
                <td className="px-3 py-2">{s.line}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {s.price_type === "free" ? "—" : formatEuro(s.price_eur)}{" "}
                  <span className="text-xs text-slate-500">{PRICE_TYPE_LABEL[s.price_type]}</span>
                </td>
                {isAdmin && (
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(s)} className="text-navy underline">
                      Ndrysho
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditService
          service={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {adding && (
        <AddService
          nextPlu={Math.max(0, ...services.map((s) => s.plu)) + 1}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function EditService(props: { service: Service; onClose: () => void; onSaved: () => void }) {
  const s = props.service;
  const [name, setName] = useState(s.name_on_list);
  const [price, setPrice] = useState(String(s.price_eur));
  const [active, setActive] = useState(s.active);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const value = parsePrice(price);
    if (value === null) return setError("Çmimi nuk është i vlefshëm.");
    if (name.trim() === "") return setError("Emri mungon.");
    if (reason.trim() === "") return setError("Shkruani arsyen e ndryshimit.");

    setBusy(true);
    const { error } = await supabase.rpc("update_service", {
      p_plu: s.plu,
      p_name_on_list: name,
      p_price_eur: value,
      p_active: active,
      p_reason: reason,
    });
    setBusy(false);
    if (error) setError(error.message);
    else props.onSaved();
  }

  return (
    <Modal title={`Ndrysho PLU ${s.plu}`} onClose={props.onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Emri në listë">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label={`Çmimi (€, ${PRICE_TYPE_LABEL[s.price_type]})`}>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={inputClass} />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Aktiv (shfaqet te punëtorët)
        </label>
        <Field label="Pse po e bëni këtë ndryshim?">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputClass} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <ModalButtons busy={busy} onClose={props.onClose} />
      </form>
    </Modal>
  );
}

function AddService(props: { nextPlu: number; onClose: () => void; onSaved: () => void }) {
  const [plu, setPlu] = useState(String(props.nextPlu));
  const [item, setItem] = useState("");
  const [category, setCategory] = useState("");
  const [service, setService] = useState("Larje");
  const [line, setLine] = useState<Service["line"]>("Casual");
  const [priceType, setPriceType] = useState<Service["price_type"]>("fixed");
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const pluNumber = Number(plu);
    const value = parsePrice(price);
    if (!Number.isInteger(pluNumber) || pluNumber <= 0) return setError("PLU nuk është i vlefshëm.");
    if (item.trim() === "" || category.trim() === "" || service.trim() === "") {
      return setError("Plotësoni artikullin, kategorinë dhe shërbimin.");
    }
    if (value === null) return setError("Çmimi nuk është i vlefshëm.");
    if (reason.trim() === "") return setError("Shkruani arsyen.");

    const name = `${item.trim()} - ${service.trim()}${line === "Luxury" ? " - Luxury Line" : ""}`;
    setBusy(true);
    const { error } = await supabase.rpc("add_service", {
      p_plu: pluNumber,
      p_name_on_list: name,
      p_item: item,
      p_category: category,
      p_service: service,
      p_line: line,
      p_price_eur: value,
      p_price_type: priceType,
      p_reason: reason,
    });
    setBusy(false);
    if (error) setError(error.message);
    else props.onSaved();
  }

  return (
    <Modal title="Shto shërbim" onClose={props.onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="PLU">
          <input value={plu} onChange={(e) => setPlu(e.target.value)} inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Artikulli (p.sh. Maicë)">
          <input value={item} onChange={(e) => setItem(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Kategoria (p.sh. Të përditshme)">
          <input value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Shërbimi (p.sh. Larje, Hekurosje)">
          <input value={service} onChange={(e) => setService(e.target.value)} className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Linja">
            <select value={line} onChange={(e) => setLine(e.target.value as Service["line"])} className={inputClass}>
              <option value="Casual">Casual</option>
              <option value="Luxury">Luxury</option>
            </select>
          </Field>
          <Field label="Lloji i çmimit">
            <select
              value={priceType}
              onChange={(e) => setPriceType(e.target.value as Service["price_type"])}
              className={inputClass}
            >
              <option value="fixed">për copë</option>
              <option value="per_kg">për kg</option>
              <option value="free">çmim i lirë</option>
            </select>
          </Field>
        </div>
        <Field label="Çmimi (€)">
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={inputClass} />
        </Field>
        <Field label="Pse po e shtoni?">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputClass} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <ModalButtons busy={busy} onClose={props.onClose} />
      </form>
    </Modal>
  );
}

const inputClass = "w-full border border-slate-300 rounded-lg px-3 py-2";

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-slate-600 mb-1">{props.label}</span>
      {props.children}
    </label>
  );
}

function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10" onClick={props.onClose}>
      <div
        className="bg-white rounded-xl shadow-lg w-full max-w-md p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-navy mb-4">{props.title}</h3>
        {props.children}
      </div>
    </div>
  );
}

function ModalButtons(props: { busy: boolean; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={props.onClose} className="px-4 py-2 rounded-lg bg-slate-100">
        Anulo
      </button>
      <button disabled={props.busy} className="px-4 py-2 rounded-lg bg-navy text-white disabled:opacity-50">
        Ruaj
      </button>
    </div>
  );
}

"use client";

// One-time first-run wizard. The API locks itself after the first school is
// created, so this page only works on a truly fresh deployment.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SetupPage() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [form, setForm] = useState({
    schoolName: "", schoolCode: "", adminName: "", adminEmail: "",
    password: "", confirm: "", motto: "", address: "", phone: "", schoolEmail: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/setup").then((r) => r.json()).then((d) => {
      if (!d.needsSetup) { router.replace("/login"); return; }
      setReady(true);
    }).catch(() => setReady(false));
  }, [router]);

  function set(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, schoolCode: form.schoolCode.toUpperCase() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        router.push("/login?setup=done");
      } else {
        setError(data.error ?? "Setup could not be completed.");
      }
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">Checking setup status…</div>;
  }

  const field = (id: keyof typeof form, label: string, type = "text", required = true, placeholder = "") => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}{!required && <span className="font-normal text-slate-400"> — optional</span>}</label>
      <input id={id} type={type} value={form[id]} onChange={set(id)} required={required} placeholder={placeholder}
        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">First-run setup</h1>
          <p className="mt-1 text-sm text-slate-500">Create the school and the first administrator account. This runs once.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">{field("schoolName", "School name", "text", true, "e.g. Nyashavee Primary School")}</div>
            {field("schoolCode", "Code", "text", true, "NPS")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("motto", "Motto", "text", false)}
            {field("phone", "School phone", "tel", false, "+263 …")}
          </div>
          {field("address", "Address", "text", false)}
          {field("schoolEmail", "School email", "email", false, "office@school.ac.zw")}
          <hr className="border-slate-200" />
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Administrator account</p>
          {field("adminName", "Full name", "text", true, "e.g. Rudo Chikafu")}
          {field("adminEmail", "Email", "email", true, "admin@school.ac.zw")}
          <div className="grid grid-cols-2 gap-3">
            {field("password", "Password", "password")}
            {field("confirm", "Confirm password", "password")}
          </div>
          <p className="text-xs text-slate-400">12+ characters with upper-case, lower-case and a number.</p>
          {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <button type="submit" disabled={loading}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:opacity-50">
            {loading ? "Creating school…" : "Create school and administrator"}
          </button>
          <p className="text-center text-sm">
            <Link href="/login" className="font-medium text-slate-500 hover:text-slate-900">Already set up? Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

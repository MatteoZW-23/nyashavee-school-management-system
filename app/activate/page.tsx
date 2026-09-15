"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function ActivateForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) return setMessage("The passwords do not match.");
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/auth/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Activation could not be completed.");
      setMessage("Your portal account is ready. You can now sign in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Activation could not be completed.");
    } finally { setLoading(false); }
  }

  return <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm"><h1 className="text-center text-2xl font-bold text-slate-900">Set up your portal account</h1><p className="mt-1 text-center text-sm text-slate-500">Use at least 12 characters with upper-case, lower-case and a number.</p>{!token ? <p className="mt-6 rounded-md bg-red-50 p-3 text-sm text-red-700">This activation link is missing its token.</p> : <form onSubmit={submit} className="mt-6 space-y-4"><label className="block text-sm font-medium text-slate-700">New password<input required minLength={12} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label><label className="block text-sm font-medium text-slate-700">Confirm password<input required minLength={12} type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>{message && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}<button disabled={loading} className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{loading ? "Setting up…" : "Set password"}</button></form>}<p className="mt-6 text-center text-sm"><Link href="/login" className="font-medium text-slate-600 hover:text-slate-900">Back to sign in</Link></p></div>;
}

export default function ActivatePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <Suspense>
        <ActivateForm />
      </Suspense>
    </div>
  );
}

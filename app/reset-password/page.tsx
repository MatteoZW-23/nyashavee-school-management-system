"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setMessage("The passwords do not match.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", token, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The password could not be reset.");
      setDone(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The password could not be reset.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Choose a new password</h1>
        <p className="mt-1 text-sm text-slate-500">At least 12 characters, including upper-case, lower-case and a number.</p>
      </div>
      {done ? (
        <div className="text-center">
          <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">Your password has been changed.</div>
          <Link href="/login" className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Sign in</Link>
        </div>
      ) : !token ? (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">This reset link is missing its token. Request a new one.</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">New password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-slate-700">Confirm password</label>
            <input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={12} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          {message && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{message}</div>}
          <button type="submit" disabled={loading} className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {loading ? "Saving..." : "Set new password"}
          </button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="font-medium text-slate-600 hover:text-slate-900">Back to sign in</Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}

"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Result =
  | { state: "loading" }
  | { state: "invalid" }
  | {
      state: "valid";
      studentName: string;
      admissionNumber: string;
      termName: string;
      academicYear: string;
      promotionStatus: string | null;
      publishedAt: string | null;
      schoolName: string;
    };

function VerifyResult() {
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  const [input, setInput] = useState(code);
  const [result, setResult] = useState<Result>({ state: "loading" });

  async function check(value: string) {
    setResult({ state: "loading" });
    try {
      const response = await fetch(`/api/verify?code=${encodeURIComponent(value)}`);
      const data = await response.json();
      setResult(data.valid ? { state: "valid", ...data } : { state: "invalid" });
    } catch {
      setResult({ state: "invalid" });
    }
  }

  useEffect(() => {
    if (!code) return;
    const timer = window.setTimeout(() => void check(code), 0);
    return () => window.clearTimeout(timer);
  }, [code]);

  return (
    <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Report card verification</h1>
        <p className="mt-1 text-sm text-slate-500">Enter the verification code printed on the report card.</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) void check(input.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. RPT-4F2A9C"
          className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm uppercase shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button type="submit" className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Verify
        </button>
      </form>

      {result.state === "loading" && (code || input.trim()) && <p className="mt-6 text-center text-sm text-slate-500">Checking…</p>}

      {result.state === "invalid" && (
        <div className="mt-6 rounded-md bg-red-50 p-4 text-center">
          <p className="text-sm font-semibold text-red-700">Not a valid published report card</p>
          <p className="mt-1 text-xs text-red-600">Check the code on the document, or contact the school.</p>
        </div>
      )}

      {result.state === "valid" && (
        <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-800">Authentic report card</p>
          <dl className="mt-3 space-y-1.5 text-sm text-slate-700">
            <div className="flex justify-between"><dt className="text-slate-500">School</dt><dd className="font-medium">{result.schoolName}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Learner</dt><dd className="font-medium">{result.studentName}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Admission no.</dt><dd className="font-mono text-xs">{result.admissionNumber}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Period</dt><dd className="font-medium">{result.academicYear} · {result.termName}</dd></div>
            {result.promotionStatus && <div className="flex justify-between"><dt className="text-slate-500">Promotion</dt><dd className="font-medium capitalize">{result.promotionStatus.replaceAll("_", " ")}</dd></div>}
            {result.publishedAt && <div className="flex justify-between"><dt className="text-slate-500">Published</dt><dd className="font-medium">{new Date(result.publishedAt).toLocaleDateString()}</dd></div>}
          </dl>
          <p className="mt-3 text-xs text-emerald-700">Subject results are private and only visible to the learner&rsquo;s fee-cleared guardians.</p>
        </div>
      )}

      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="font-medium text-slate-600 hover:text-slate-900">School sign in</Link>
      </p>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <Suspense>
        <VerifyResult />
      </Suspense>
    </div>
  );
}

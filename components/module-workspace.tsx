"use client";

import { ArrowRight, CheckCircle2, CircleDashed, Construction, Database, LockKeyhole, MapPin, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ModuleDefinition, ModuleId } from "@/components/school-app";

const statusStyles = {
  live: "border-[#b9d7ca] bg-[#e7f2ed] text-[#245e4c]",
  foundation: "border-[#e4d2a4] bg-[#fbf2d9] text-[#805e16]",
  planned: "border-[#d9dfdc] bg-[#eff2f0] text-[#68756f]",
};

const statusCopy = {
  live: "This workflow is operational and backed by the school database.",
  foundation: "Its secure data foundation exists; the remaining end-to-end workflow is still being built.",
  planned: "This module is part of the approved architecture but is not operational in this build.",
};

export function ModuleWorkspace({ module, onNavigate }: { module: ModuleDefinition; onNavigate: (id: ModuleId) => void }) {
  const Icon = module.icon;
  const canContinue = module.id === "admissions" || module.id === "guardians" || module.id === "academics" || module.id === "documents";

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[#dbe4df] bg-white shadow-[0_8px_28px_rgba(25,55,46,.05)]">
        <div className="grid gap-8 px-6 py-7 sm:px-8 sm:py-9 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
          <div>
            <span className="grid size-12 place-items-center rounded-2xl bg-[#e7f0eb] text-[#28624f]"><Icon className="size-6" /></span>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#173329] sm:text-4xl">{module.title}</h1>
              <Badge variant="outline" className={statusStyles[module.status]}>{module.status === "foundation" ? "Foundation ready" : module.status === "planned" ? "Planned" : "Live"}</Badge>
            </div>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[#65756d]">{module.description}</p>
          </div>
          <div className="rounded-xl border border-[#e1e7e4] bg-[#f7f9f8] p-4">
            <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#39725f]" /><div><p className="text-sm font-semibold">Delivery status</p><p className="mt-1 text-xs leading-5 text-[#6e7c75]">{statusCopy[module.status]}</p></div></div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="gap-0 border-[#dce4e0] bg-white py-0 shadow-[0_1px_2px_rgba(20,45,37,.04)]">
          <CardHeader className="border-b border-[#e6ebe8] px-5 py-5 sm:px-6">
            <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-[#e4f0ea] text-[#28644f]"><Database className="size-4" /></span><div><CardTitle className="font-serif text-xl">Available now</CardTitle><CardDescription className="mt-1">Capabilities that exist in this build.</CardDescription></div></div>
          </CardHeader>
          <CardContent className="px-5 py-5 sm:px-6">
            {module.available.length ? (
              <ul className="space-y-3">
                {module.available.map((item) => <li key={item} className="flex items-start gap-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#34715d]" /><span>{item}</span></li>)}
              </ul>
            ) : (
              <div className="rounded-xl border border-dashed border-[#d9e1dd] bg-[#f8faf9] px-5 py-8 text-center">
                <Construction className="mx-auto size-6 text-[#89958f]" />
                <p className="mt-3 text-sm font-semibold">Not available in this build</p>
                <p className="mt-1 text-xs leading-5 text-[#75827c]">No sample records or simulated actions are shown here.</p>
              </div>
            )}
            {canContinue && (
              <Button
                variant="outline"
                className="mt-5 border-[#cedbd5] text-[#245f4d]"
                onClick={() => onNavigate("students")}
              >
                Open student records <ArrowRight />
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 border-[#dce4e0] bg-white py-0 shadow-[0_1px_2px_rgba(20,45,37,.04)]">
          <CardHeader className="border-b border-[#e6ebe8] px-5 py-5 sm:px-6">
            <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-[#f8efd7] text-[#8b6518]"><CircleDashed className="size-4" /></span><div><CardTitle className="font-serif text-xl">Still required</CardTitle><CardDescription className="mt-1">Work needed before this module can be trusted in production.</CardDescription></div></div>
          </CardHeader>
          <CardContent className="px-5 py-5 sm:px-6">
            {module.next.length ? (
              <ol className="space-y-3">
                {module.next.map((item, index) => <li key={item} className="flex items-start gap-3 text-sm"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#f0f2f1] text-[10px] font-bold text-[#6e7a74]">{index + 1}</span><span>{item}</span></li>)}
              </ol>
            ) : (
              <div className="flex items-center gap-3 rounded-xl bg-[#eaf3ef] p-4 text-sm text-[#285f4e]"><CheckCircle2 className="size-5" />The listed journey is operational.</div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="flex gap-3 rounded-xl border border-[#dce4e0] bg-white p-4"><LockKeyhole className="mt-0.5 size-5 shrink-0 text-[#376c5a]" /><div><p className="text-sm font-semibold">Permission first</p><p className="mt-1 text-xs leading-5 text-[#728078]">Sensitive actions are enforced on the server, not only hidden in the interface.</p></div></div>
        <div className="flex gap-3 rounded-xl border border-[#dce4e0] bg-white p-4"><MapPin className="mt-0.5 size-5 shrink-0 text-[#376c5a]" /><div><p className="text-sm font-semibold">Zimbabwe ready</p><p className="mt-1 text-xs leading-5 text-[#728078]">The architecture accounts for local terms, ZIMSEC reporting and USD/ZiG records.</p></div></div>
        <div className="flex gap-3 rounded-xl border border-[#dce4e0] bg-white p-4"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#376c5a]" /><div><p className="text-sm font-semibold">School isolated</p><p className="mt-1 text-xs leading-5 text-[#728078]">Every implemented query is scoped to the signed-in school membership.</p></div></div>
      </section>
    </div>
  );
}

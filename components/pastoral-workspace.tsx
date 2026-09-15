"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { isQueuedResponse, OFFLINE_QUEUED_MESSAGE } from "@/lib/api-client";
import { Activity, HeartPulse, RefreshCw, ShieldAlert, ShieldCheck, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type PastoralModule = "health" | "safeguarding" | "sen" | "pickups" | "activities";
type Item = Record<string, string | number | boolean | null>;
type Data = { module: string; records: Item[]; secondary: Record<string, Item[]>; references: { students: Item[]; classrooms: Item[] }; permissions: { manage: boolean } };

const copy: Record<PastoralModule, { title: string; description: string; badge: string; primary: string; icon: typeof HeartPulse }> = {
  health: { title: "Health profiles", description: "Confidential medical details — blood group, allergies, conditions, medications and emergency instructions.", badge: "Restricted", primary: "Update health record", icon: HeartPulse },
  safeguarding: { title: "Safeguarding", description: "Child-protection concerns. Restricted to designated safeguarding personnel.", badge: "Highly restricted", primary: "Open case", icon: ShieldAlert },
  sen: { title: "Learning support", description: "Special educational needs — assessments, intervention plans, accommodations and reviews.", badge: "Confidential", primary: "New support plan", icon: ShieldCheck },
  pickups: { title: "Pickup authorization", description: "Named adults authorized to collect learners, with validity and revocation.", badge: "Guardian-approved", primary: "Authorize pickup", icon: UserRoundCheck },
  activities: { title: "Clubs & trips", description: "Extracurricular clubs, membership, excursions, consent and payment tracking.", badge: "Extracurricular", primary: "New club", icon: Activity },
};

const text = (i: Item, k: string) => String(i[k] ?? "");
const nameOf = (s: Item) => `${text(s, "lastName")}, ${text(s, "firstName")} · ${text(s, "admissionNumber")}`;
const fmtDate = (v: unknown) => (v ? String(v).slice(0, 10) : "—");
const money = (minor: number, ccy: string) => `${ccy === "ZWG" ? "ZiG" : "$"} ${(minor / 100).toFixed(2)}`;

export function PastoralWorkspace({ module }: { module: PastoralModule }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const info = copy[module];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/operations?module=${module}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load records.");
      setData(json);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load records.");
    } finally {
      setLoading(false);
    }
  }, [module]);

  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  const send = useCallback(async (body: Record<string, unknown>, ok: string) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (isQueuedResponse(json)) { toast.info(OFFLINE_QUEUED_MESSAGE); return json; }
      if (!res.ok) throw new Error(json.error || "The operation could not be completed.");
      toast.success(ok);
      setMode(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The operation could not be completed.");
    } finally {
      setSubmitting(false);
    }
  }, [load]);

  const records = useMemo(() => {
    const rows = data?.records ?? [];
    if (!query) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)));
  }, [data, query]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const val = (k: string) => String(f.get(k) ?? "");
    if (mode === "health") void send({ action: "save_health_record", studentId: val("studentId"), bloodGroup: val("bloodGroup"), allergies: val("allergies"), chronicConditions: val("chronicConditions"), medications: val("medications"), disabilities: val("disabilities"), doctorName: val("doctorName"), doctorPhone: val("doctorPhone"), medicalAid: val("medicalAid"), emergencyNotes: val("emergencyNotes") }, "Health record saved.");
    if (mode === "safeguarding") void send({ action: "create_safeguarding_case", studentId: val("studentId"), concernType: val("concernType"), details: val("details"), officerId: val("officerId") || undefined, followUpAt: val("followUpAt") || undefined }, "Safeguarding case opened.");
    if (mode === "sen") void send({ action: "save_special_need", studentId: val("studentId"), category: val("category"), assessmentSummary: val("assessmentSummary"), interventionPlan: val("interventionPlan"), accommodations: val("accommodations"), targets: val("targets"), reviewDate: val("reviewDate") || undefined }, "Support plan saved.");
    if (mode === "pickup") void send({ action: "save_pickup", studentId: val("studentId"), name: val("name"), relationship: val("relationship"), phone: val("phone"), idNumber: val("idNumber"), validTo: val("validTo") || undefined }, "Pickup authorized.");
    if (mode === "club") void send({ action: "save_club", name: val("name"), category: val("category"), schedule: val("schedule") }, "Club created.");
    if (mode === "join") void send({ action: "join_club", clubId: val("clubId"), studentId: val("studentId"), role: val("role") }, "Learner added to club.");
    if (mode === "trip") void send({ action: "save_trip", title: val("title"), destination: val("destination"), startDate: val("startDate"), endDate: val("endDate"), cost: val("cost"), currency: val("currency") || "USD" }, "Trip saved.");
    if (mode === "participant") void send({ action: "add_trip_participant", tripId: val("tripId"), studentId: val("studentId") }, "Learner registered for trip.");
  };

  const students = data?.references.students ?? [];
  const clubs = module === "activities" ? data?.records ?? [] : [];
  const trips = (data?.secondary.trips ?? []) as Item[];
  const clubMembers = (data?.secondary.clubMembers ?? []) as Item[];
  const tripParticipants = (data?.secondary.tripParticipants ?? []) as Item[];
  const officers = (data?.secondary.officers ?? []) as Item[];
  const canManage = data?.permissions.manage === true;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge className="bg-[#f0e6dd] text-[#8a5231]">{info.badge}</Badge>
          <h2 className="mt-3 font-serif text-3xl font-semibold text-[#173329]">{info.title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#68776f]">{info.description}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => void load()} aria-label="Refresh"><RefreshCw className="size-4" /></Button>
          {canManage && <Button onClick={() => setMode(module === "activities" ? "club" : module === "pickups" ? "pickup" : module)}>{info.primary}</Button>}
        </div>
      </div>

      {module !== "activities" && (
        <Input placeholder="Search records…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />
      )}

      {loading ? <Skeleton className="h-80 w-full rounded-xl" /> : (
        <>
          {module === "health" && (
            <Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><Table>
              <TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Learner</TableHead><TableHead>Blood</TableHead><TableHead>Allergies</TableHead><TableHead>Conditions</TableHead><TableHead>Medications</TableHead><TableHead>Doctor</TableHead><TableHead className="pr-5">Updated</TableHead></TableRow></TableHeader>
              <TableBody>{records.map((r) => <TableRow key={text(r, "id")}>
                <TableCell className="py-3 pl-5 font-semibold">{text(r, "studentName")}<span className="block text-xs font-normal text-[#87928d]">{text(r, "admissionNumber")}</span></TableCell>
                <TableCell>{text(r, "bloodGroup") || "—"}</TableCell>
                <TableCell className="text-[#984e34]">{text(r, "allergies") || "—"}</TableCell>
                <TableCell>{text(r, "chronicConditions") || "—"}</TableCell>
                <TableCell>{text(r, "medications") || "—"}</TableCell>
                <TableCell className="text-xs">{text(r, "doctorName")} {text(r, "doctorPhone")}</TableCell>
                <TableCell className="pr-5 text-xs">{fmtDate(r.updatedAt)}</TableCell>
              </TableRow>)}</TableBody></Table>
            {records.length === 0 && <p className="px-5 py-8 text-center text-sm text-[#68776f]">No health profiles recorded yet.</p>}</Card>
          )}

          {module === "safeguarding" && (
            <Card className="gap-0 overflow-hidden border-[#e5c3b4] bg-white py-0"><Table>
              <TableHeader className="bg-[#faf4f0]"><TableRow><TableHead className="pl-5">Learner</TableHead><TableHead>Concern</TableHead><TableHead>Status</TableHead><TableHead>Officer</TableHead><TableHead>Follow-up</TableHead><TableHead className="pr-5"></TableHead></TableRow></TableHeader>
              <TableBody>{records.map((r) => <TableRow key={text(r, "id")}>
                <TableCell className="py-3 pl-5 font-semibold">{text(r, "studentName")}<span className="block text-xs font-normal text-[#87928d]">{text(r, "admissionNumber")}</span></TableCell>
                <TableCell>{text(r, "concernType")}</TableCell>
                <TableCell><Badge variant="outline" className={text(r, "status") === "open" ? "border-[#e5c3b4] text-[#984e34]" : ""}>{text(r, "status")}</Badge></TableCell>
                <TableCell className="text-xs">{text(r, "officer") || "—"}</TableCell>
                <TableCell className="text-xs">{fmtDate(r.followUpAt)}</TableCell>
                <TableCell className="pr-5 text-right">{canManage && text(r, "status") !== "closed" && (
                  <div className="flex justify-end gap-1">
                    {text(r, "status") === "open" && <Button size="sm" variant="outline" onClick={() => void send({ action: "update_safeguarding_case", caseId: text(r, "id"), status: "escalated" }, "Case escalated.")}>Escalate</Button>}
                    {text(r, "status") === "escalated" && <Button size="sm" variant="outline" onClick={() => void send({ action: "update_safeguarding_case", caseId: text(r, "id"), status: "referred" }, "Case referred.")}>Refer</Button>}
                    <Button size="sm" variant="ghost" onClick={() => { const note = window.prompt("Actions taken / closure note:"); void send({ action: "update_safeguarding_case", caseId: text(r, "id"), status: "closed", actions: note ?? "" }, "Case closed."); }}>Close</Button>
                  </div>)}
                </TableCell>
              </TableRow>)}</TableBody></Table>
            {records.length === 0 && <p className="px-5 py-8 text-center text-sm text-[#68776f]">No safeguarding cases on record.</p>}</Card>
          )}

          {module === "sen" && (
            <Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><Table>
              <TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Learner</TableHead><TableHead>Category</TableHead><TableHead>Plan</TableHead><TableHead>Responsible</TableHead><TableHead>Review</TableHead><TableHead className="pr-5">Status</TableHead></TableRow></TableHeader>
              <TableBody>{records.map((r) => <TableRow key={text(r, "id")}>
                <TableCell className="py-3 pl-5 font-semibold">{text(r, "studentName")}<span className="block text-xs font-normal text-[#87928d]">{text(r, "admissionNumber")}</span></TableCell>
                <TableCell>{text(r, "category")}</TableCell>
                <TableCell className="max-w-56 truncate text-xs">{text(r, "interventionPlan") || "—"}</TableCell>
                <TableCell className="text-xs">{text(r, "responsible") || "—"}</TableCell>
                <TableCell className="text-xs">{fmtDate(r.reviewDate)}</TableCell>
                <TableCell className="pr-5"><Badge variant="outline">{text(r, "status")}</Badge></TableCell>
              </TableRow>)}</TableBody></Table>
            {records.length === 0 && <p className="px-5 py-8 text-center text-sm text-[#68776f]">No support plans recorded.</p>}</Card>
          )}

          {module === "pickups" && (
            <Card className="gap-0 overflow-hidden border-[#dce4e0] bg-white py-0"><Table>
              <TableHeader className="bg-[#f7f9f8]"><TableRow><TableHead className="pl-5">Learner</TableHead><TableHead>Authorized person</TableHead><TableHead>Relationship</TableHead><TableHead>Phone</TableHead><TableHead>Valid to</TableHead><TableHead className="pr-5"></TableHead></TableRow></TableHeader>
              <TableBody>{records.map((r) => <TableRow key={text(r, "id")}>
                <TableCell className="py-3 pl-5 font-semibold">{text(r, "studentName")}<span className="block text-xs font-normal text-[#87928d]">{text(r, "admissionNumber")}</span></TableCell>
                <TableCell>{text(r, "name")}</TableCell>
                <TableCell>{text(r, "relationship")}</TableCell>
                <TableCell className="font-mono text-xs">{text(r, "phone")}</TableCell>
                <TableCell className="text-xs">{fmtDate(r.validTo)}</TableCell>
                <TableCell className="pr-5 text-right">{text(r, "status") === "active"
                  ? (canManage && <Button size="sm" variant="ghost" onClick={() => void send({ action: "revoke_pickup", pickupId: text(r, "id") }, "Authorization revoked.")}>Revoke</Button>)
                  : <Badge variant="outline" className="border-[#e5c3b4] text-[#984e34]">revoked</Badge>}
                </TableCell>
              </TableRow>)}</TableBody></Table>
            {records.length === 0 && <p className="px-5 py-8 text-center text-sm text-[#68776f]">No pickup authorizations recorded.</p>}</Card>
          )}

          {module === "activities" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="gap-0 border-[#dce4e0] bg-white py-0">
                <CardHeader className="border-b border-[#e5ebe8] px-5 py-4"><div className="flex items-center justify-between"><div><CardTitle className="font-serif text-lg">Clubs</CardTitle><CardDescription>Extracurricular clubs and membership</CardDescription></div>{canManage && <Button size="sm" variant="outline" onClick={() => setMode("join")}>Add member</Button>}</div></CardHeader>
                <CardContent className="divide-y divide-[#eef1ef] px-5 py-1">
                  {clubs.map((c) => <div key={text(c, "id")} className="flex items-center justify-between py-2.5"><div><p className="text-sm font-semibold">{text(c, "name")}</p><p className="text-xs text-[#87928d]">{text(c, "category")} · {text(c, "schedule")} · {text(c, "coordinator")}</p></div><Badge variant="outline">{c.members} members</Badge></div>)}
                  {clubs.length === 0 && <p className="py-6 text-sm text-[#68776f]">No clubs yet.</p>}
                </CardContent>
              </Card>
              <Card className="gap-0 border-[#dce4e0] bg-white py-0">
                <CardHeader className="border-b border-[#e5ebe8] px-5 py-4"><div className="flex items-center justify-between"><div><CardTitle className="font-serif text-lg">Trips</CardTitle><CardDescription>Excursions with consent tracking</CardDescription></div>{canManage && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setMode("participant")}>Add learner</Button><Button size="sm" onClick={() => setMode("trip")}>New trip</Button></div>}</div></CardHeader>
                <CardContent className="divide-y divide-[#eef1ef] px-5 py-1">
                  {trips.map((t) => <div key={text(t, "id")} className="py-2.5"><div className="flex items-center justify-between"><p className="text-sm font-semibold">{text(t, "title")} — {text(t, "destination")}</p><Badge variant="outline">{text(t, "status")}</Badge></div><p className="text-xs text-[#87928d]">{fmtDate(t.startDate)} → {fmtDate(t.endDate)} · {money(Number(t.costMinor), text(t, "currency"))} · {t.participants} registered</p>
                    <div className="mt-1 space-y-1">{tripParticipants.filter((p) => text(p, "tripId") === text(t, "id")).map((p) => (
                      <div key={text(p, "id")} className="flex items-center justify-between text-xs"><span>{text(p, "studentName")}</span>
                        {canManage && text(p, "consentStatus") === "pending"
                          ? <div className="flex gap-1"><Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => void send({ action: "set_trip_consent", participantId: text(p, "id"), consentStatus: "given" }, "Consent recorded.")}>Consent</Button><Button size="sm" variant="ghost" className="h-6 px-2 text-[#984e34]" onClick={() => void send({ action: "set_trip_consent", participantId: text(p, "id"), consentStatus: "declined" }, "Declined.")}>Decline</Button></div>
                          : <Badge variant="outline" className="h-5 text-[10px]">{text(p, "consentStatus")}{Number(p.paidMinor) > 0 ? ` · paid ${money(Number(p.paidMinor), text(t, "currency"))}` : ""}</Badge>}
                      </div>))}
                    </div>
                  </div>)}
                  {trips.length === 0 && <p className="py-6 text-sm text-[#68776f]">No trips planned.</p>}
                </CardContent>
              </Card>
              <Card className="gap-0 border-[#dce4e0] bg-white py-0 lg:col-span-2">
                <CardHeader className="px-5 py-4"><CardTitle className="font-serif text-lg">Recent club memberships</CardTitle></CardHeader>
                <CardContent className="px-5 pb-4"><div className="flex flex-wrap gap-2">{clubMembers.slice(0, 40).map((m) => <Badge key={text(m, "id")} variant="outline">{text(m, "studentName")} — {text(m, "club")}</Badge>)}{clubMembers.length === 0 && <p className="text-sm text-[#68776f]">No memberships yet.</p>}</div></CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      <Dialog open={mode !== null} onOpenChange={(open) => !open && setMode(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{info.primary}</DialogTitle><DialogDescription>All entries are school-scoped and audited.</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            {(mode === "health" || mode === "safeguarding" || mode === "sen" || mode === "pickup" || mode === "join" || mode === "participant") && (
              <div className="space-y-2 sm:col-span-2"><Label>Learner</Label>
                <select name="studentId" required className="h-9 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm">{students.map((st) => <option key={text(st, "id")} value={text(st, "id")}>{nameOf(st)}</option>)}</select>
              </div>
            )}
            {mode === "health" && (<>
              <div className="space-y-2"><Label>Blood group</Label><Input name="bloodGroup" placeholder="O+" /></div>
              <div className="space-y-2"><Label>Medical aid</Label><Input name="medicalAid" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Allergies</Label><Input name="allergies" placeholder="e.g. Peanuts, bee stings" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Chronic conditions</Label><Input name="chronicConditions" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Current medications</Label><Input name="medications" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Disabilities</Label><Input name="disabilities" /></div>
              <div className="space-y-2"><Label>Doctor name</Label><Input name="doctorName" /></div>
              <div className="space-y-2"><Label>Doctor phone</Label><Input name="doctorPhone" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Emergency notes</Label><Input name="emergencyNotes" /></div>
            </>)}
            {mode === "safeguarding" && (<>
              <div className="space-y-2"><Label>Concern type</Label><Input name="concernType" required placeholder="e.g. Physical, neglect, disclosure" /></div>
              <div className="space-y-2"><Label>Follow-up date</Label><Input name="followUpAt" type="date" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Details (restricted)</Label><Input name="details" required /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Designated officer</Label>
                <select name="officerId" className="h-9 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm"><option value="">Unassigned</option>{officers.map((o) => <option key={text(o, "id")} value={text(o, "id")}>{text(o, "name")}</option>)}</select>
              </div>
            </>)}
            {mode === "sen" && (<>
              <div className="space-y-2"><Label>Category</Label><Input name="category" required placeholder="e.g. Reading support, hearing" /></div>
              <div className="space-y-2"><Label>Review date</Label><Input name="reviewDate" type="date" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Assessment summary</Label><Input name="assessmentSummary" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Intervention plan</Label><Input name="interventionPlan" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Accommodations</Label><Input name="accommodations" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Targets</Label><Input name="targets" /></div>
            </>)}
            {mode === "pickup" && (<>
              <div className="space-y-2"><Label>Person name</Label><Input name="name" required /></div>
              <div className="space-y-2"><Label>Relationship</Label><Input name="relationship" required placeholder="Aunt, driver, neighbour" /></div>
              <div className="space-y-2"><Label>Phone</Label><Input name="phone" required /></div>
              <div className="space-y-2"><Label>ID number</Label><Input name="idNumber" /></div>
              <div className="space-y-2"><Label>Valid until</Label><Input name="validTo" type="date" /></div>
            </>)}
            {mode === "club" && (<>
              <div className="space-y-2 sm:col-span-2"><Label>Club name</Label><Input name="name" required placeholder="e.g. Chess Club" /></div>
              <div className="space-y-2"><Label>Category</Label><Input name="category" placeholder="Sport, arts, academic" /></div>
              <div className="space-y-2"><Label>Schedule</Label><Input name="schedule" placeholder="Tuesdays 14:00" /></div>
            </>)}
            {mode === "join" && (<>
              <div className="space-y-2"><Label>Club</Label>
                <select name="clubId" required className="h-9 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm">{clubs.map((c) => <option key={text(c, "id")} value={text(c, "id")}>{text(c, "name")}</option>)}</select>
              </div>
              <div className="space-y-2"><Label>Role</Label><Input name="role" placeholder="Member, captain…" /></div>
            </>)}
            {mode === "trip" && (<>
              <div className="space-y-2 sm:col-span-2"><Label>Trip title</Label><Input name="title" required placeholder="Grade 6 Great Zimbabwe visit" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Destination</Label><Input name="destination" required /></div>
              <div className="space-y-2"><Label>Start</Label><Input name="startDate" type="date" required /></div>
              <div className="space-y-2"><Label>End</Label><Input name="endDate" type="date" required /></div>
              <div className="space-y-2"><Label>Cost per learner</Label><Input name="cost" placeholder="25.00" /></div>
              <div className="space-y-2"><Label>Currency</Label><select name="currency" className="h-9 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm"><option value="USD">USD</option><option value="ZWG">ZiG</option></select></div>
            </>)}
            {mode === "participant" && (
              <div className="space-y-2 sm:col-span-2"><Label>Trip</Label>
                <select name="tripId" required className="h-9 w-full rounded-md border border-[#d4ded9] bg-white px-3 text-sm">{trips.map((t) => <option key={text(t, "id")} value={text(t, "id")}>{text(t, "title")} — {fmtDate(t.startDate)}</option>)}</select>
              </div>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={() => setMode(null)}>Cancel</Button><Button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

import { z } from "zod";
import { getDb } from "@/db";
import { clientIp, rateLimit, rateLimited } from "@/lib/rate-limit";

function maskName(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "Learner";
  return `${words[0][0]}. ${words.length > 1 ? `${words[words.length - 1][0]}.` : ""}`.trim();
}

function maskAdmissionNumber(value: string) {
  return value.length <= 4 ? "••••" : `${"•".repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
}

// Public endpoint — confirms a report card is genuine by its verification code.
// Deliberately returns no scores: verification proves authenticity, not results.
export async function GET(request: Request) {
  try {
    // Throttle code enumeration: 30 lookups per IP per 10 minutes.
    const limit = await rateLimit(`verify:${clientIp(request)}`, 30, 10 * 60 * 1000);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds, limit.unavailable);
    const code = z.string().trim().min(4).max(40).parse(new URL(request.url).searchParams.get("code"));
    const db = getDb();
    const report = await db.reportCard.findFirst({
      where: { verificationCode: code, status: "published" },
      select: {
        verificationCode: true,
        studentNameSnapshot: true,
        admissionNumberSnapshot: true,
        promotionStatus: true,
        publishedAt: true,
        term: { select: { name: true, academicYear: { select: { name: true } } } },
        school: { select: { name: true } },
      },
    });
    if (!report) {
      return Response.json({ valid: false });
    }
    return Response.json({
      valid: true,
      // Verification proves authenticity; it must not become a public learner
      // directory for people who obtain or guess a report code.
      studentName: maskName(report.studentNameSnapshot),
      admissionNumber: maskAdmissionNumber(report.admissionNumberSnapshot),
      termName: report.term.name,
      academicYear: report.term.academicYear.name,
      promotionStatus: report.promotionStatus,
      publishedAt: report.publishedAt,
      schoolName: report.school.name,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ valid: false, error: "Invalid code." }, { status: 400 });
    return Response.json({ valid: false, error: "Verification unavailable." }, { status: 500 });
  }
}

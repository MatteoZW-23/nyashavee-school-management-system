import type { getDb } from "@/db";

type Db = ReturnType<typeof getDb>;

// Which assessment types count as examination vs continuous assessment.
// Overridable per assessment via the `component` column.
export const EXAM_TYPES = new Set(["midterm_exam", "end_of_term_exam", "final_exam", "exam", "examination"]);
export const CA_TYPES = new Set(["exercise", "class_exercise", "homework", "assignment", "test", "class_test", "project", "practical", "coursework", "quiz"]);

export function componentFor(assessmentType: string, component?: string | null) {
  if (component === "ca" || component === "exam") return component;
  return EXAM_TYPES.has(assessmentType) ? "exam" : "ca";
}

export function gradeFor(percent: number, bands: Array<{ minPercent: number; maxPercent: number; grade: string; remark: string | null }>) {
  const band = bands.find((item) => percent >= item.minPercent && percent <= item.maxPercent);
  if (band) return { grade: band.grade, remark: band.remark };
  if (percent >= 80) return { grade: "A", remark: "Excellent" };
  if (percent >= 70) return { grade: "B", remark: "Very good" };
  if (percent >= 60) return { grade: "C", remark: "Good" };
  if (percent >= 50) return { grade: "D", remark: "Satisfactory" };
  return { grade: "E", remark: "Needs improvement" };
}

type SubjectMarks = {
  subjectCode: string;
  subjectName: string;
  subjectId: string;
  assessments: Array<{ id: string; title: string; component: string; maxMarks: number; weightPercent: number; score: number | null; comment: string | null }>;
};

function weightedPercent(items: SubjectMarks["assessments"]) {
  const scored = items.filter((item) => item.score !== null);
  if (!scored.length) return null;
  const weight = scored.reduce((sum, item) => sum + item.weightPercent, 0);
  if (!weight) return Math.round(scored.reduce((sum, item) => sum + (item.score! * 100) / item.maxMarks, 0) / scored.length);
  return Math.round(scored.reduce((sum, item) => sum + ((item.score! * 100 * item.weightPercent) / item.maxMarks), 0) / weight);
}

// Compute one learner's subject results for a term: CA/exam split, weighted
// final, grade, and previous-term comparison for the same subject only.
export async function computeTermResults(db: Db, schoolId: string, studentId: string, classroomId: string, termId: string) {
  const assessmentRows = await db.assessment.findMany({
    where: { schoolId, termId, status: "published", classSubject: { schoolId, classroomId } },
    select: {
      id: true, title: true, assessmentType: true, component: true, maxMarks: true, weightPercent: true,
      classSubject: { select: { subject: { select: { id: true, code: true, name: true } } } },
      marks: { where: { studentId }, select: { score: true, comment: true }, take: 1 },
    },
    orderBy: [{ classSubject: { subject: { name: "asc" } } }, { dueDate: "asc" }],
  });

  const groups = new Map<string, SubjectMarks>();
  for (const row of assessmentRows) {
    const key = row.classSubject.subject.id;
    const group = groups.get(key) ?? { subjectCode: row.classSubject.subject.code, subjectName: row.classSubject.subject.name, subjectId: row.classSubject.subject.id, assessments: [] };
    group.assessments.push({
      id: row.id,
      title: row.title,
      component: componentFor(row.assessmentType, row.component),
      maxMarks: row.maxMarks,
      weightPercent: row.weightPercent,
      score: row.marks[0]?.score ?? null,
      comment: row.marks[0]?.comment ?? null,
    });
    groups.set(key, group);
  }

  const [weightings, bands, previousReport] = await Promise.all([
    db.reportWeighting.findMany({ where: { schoolId }, select: { subjectId: true, caPercent: true, examPercent: true } }),
    db.gradingBand.findMany({ where: { schoolId }, select: { minPercent: true, maxPercent: true, grade: true, remark: true }, orderBy: { sortOrder: "asc" } }),
    // Most recent published report from an earlier term — same-school only.
    db.reportCard.findFirst({
      where: { schoolId, studentId, status: "published", term: { id: { not: termId } } },
      select: { results: { select: { subjectCodeSnapshot: true, scorePercent: true } }, term: { select: { name: true } } },
      orderBy: { term: { endDate: "desc" } },
    }),
  ]);
  const defaultWeighting = weightings.find((row) => row.subjectId === null) ?? { caPercent: 40, examPercent: 60 };
  const weightingFor = (subjectId: string) => weightings.find((row) => row.subjectId === subjectId) ?? defaultWeighting;
  const previousBySubject = new Map((previousReport?.results ?? []).map((row) => [row.subjectCodeSnapshot, row.scorePercent]));

  const results = [];
  const missing: string[] = [];
  for (const group of groups.values()) {
    const ca = group.assessments.filter((item) => item.component === "ca");
    const exam = group.assessments.filter((item) => item.component === "exam");
    const weighting = weightingFor(group.subjectId);
    const caPercent = weightedPercent(ca);
    const examPercent = weightedPercent(exam);

    for (const item of group.assessments) {
      if (item.score === null) missing.push(`${group.subjectName}: ${item.title} mark`);
    }
    if (ca.length && caPercent === null) missing.push(`${group.subjectName} continuous assessment mark`);
    if (exam.length && examPercent === null) missing.push(`${group.subjectName} examination mark`);

    // If a subject simply has no exam or no CA component configured, the
    // present component carries 100% — the split only applies when both exist.
    const finalPercent = caPercent === null && examPercent === null
      ? null
      : exam.length === 0 || examPercent === null
        ? (caPercent ?? examPercent)
        : ca.length === 0 || caPercent === null
          ? examPercent
          : Math.round((caPercent * weighting.caPercent + examPercent * weighting.examPercent) / 100);
    const previousPercent = previousBySubject.get(group.subjectCode) ?? null;
    const changePercent = finalPercent !== null && previousPercent !== null ? finalPercent - previousPercent : null;
    const trend = changePercent === null ? null : changePercent >= 3 ? "improving" : changePercent <= -3 ? "declining" : "stable";
    const graded = finalPercent === null ? { grade: "—", remark: "Incomplete" } : gradeFor(finalPercent, bands);

    results.push({
      subjectId: group.subjectId,
      subjectCode: group.subjectCode,
      subjectName: group.subjectName,
      caPercent,
      examPercent,
      scorePercent: finalPercent ?? 0,
      previousPercent,
      changePercent,
      trend,
      grade: graded.grade,
      remark: graded.remark ?? "",
      assessmentCount: group.assessments.length,
      hasCa: ca.length > 0,
      hasExam: exam.length > 0,
    });
  }

  const scored = results.filter((result) => result.scorePercent !== null);
  const averagePercent = scored.length ? Math.round(scored.reduce((sum, result) => sum + result.scorePercent, 0) / scored.length) : null;
  const previousScores = results.map((result) => result.previousPercent).filter((value): value is number => value !== null);
  const previousAverage = previousScores.length ? Math.round(previousScores.reduce((a, b) => a + b, 0) / previousScores.length) : null;

  return { results, missing, averagePercent, previousAverage, previousTermName: previousReport?.term.name ?? null };
}

// What a report is missing before it can move forward in the pipeline:
// unentered marks (from computeTermResults.missing), unsubmitted subject
// comments (from stored results), and the class teacher's overall comment.
export function reportBlockers(
  missing: string[],
  storedResults: Array<{ subjectNameSnapshot: string; teacherComment: string | null }>,
  report: { classTeacherComment: string | null }
) {
  const blockers = [...missing];
  for (const result of storedResults) {
    if (!result.teacherComment) blockers.push(`${result.subjectNameSnapshot} teacher comment`);
  }
  if (!report.classTeacherComment) blockers.push("Class teacher comment");
  return blockers;
}

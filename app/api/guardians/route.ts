import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getDb } from "@/db";
import { getSchoolContext, requirePermission, type SchoolContext } from "@/lib/request-context";
import { hasPermission } from "@/lib/permissions";

const uuid = z.string().min(1).max(64);
const guardianInput = z.object({
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(30),
  secondaryPhone: z.string().trim().max(30).optional(),
  whatsappPhone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  nationalId: z.string().trim().max(40).optional(),
  relationship: z.string().trim().min(2).max(40),
  address: z.string().trim().max(300).optional(),
  occupation: z.string().trim().max(100).optional(),
  employer: z.string().trim().max(120).optional(),
  isFinancialContact: z.boolean().default(true),
});

function audit(db: ReturnType<typeof getDb>, context: SchoolContext, action: string, id: string, details: object = {}) {
  return db.auditLog.create({
    data: {
      schoolId: context.schoolId,
      actorMembershipId: context.membershipId,
      action,
      entityType: "guardian",
      entityId: id,
      details: JSON.stringify(details),
    },
  });
}

function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return Response.json({ error: "Please check the guardian details." }, { status: 400 });
  const message = error instanceof Error ? error.message : "";
  if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") || /UNIQUE constraint/i.test(message)) {
    return Response.json({ error: "That guardian relationship already exists." }, { status: 409 });
  }
  return Response.json({ error: "The guardian record could not be completed." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "guardians.view");
    const url = new URL(request.url);
    const query = (url.searchParams.get("q")?.trim() ?? "").slice(0, 80);
    const guardianId = url.searchParams.get("guardianId");
    const db = getDb();
    const rows = await db.guardian.findMany({
      where: {
        schoolId: context.schoolId,
        ...(query
          ? {
              OR: [
                { firstName: { contains: query } },
                { lastName: { contains: query } },
                { phone: { contains: query } },
                { email: { contains: query } },
                { nationalId: { contains: query } },
              ],
            }
          : {}),
      },
      include: {
        studentGuardians: {
          include: {
            student: {
              select: { schoolId: true, archivedAt: true, firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 250,
    });
    const guardians = rows.map((guardian) => {
      const children = guardian.studentGuardians
        .filter((link) => link.student.schoolId === guardian.schoolId && link.student.archivedAt === null)
        .map((link) => `${link.student.firstName} ${link.student.lastName}`);
      return {
        id: guardian.id,
        firstName: guardian.firstName,
        lastName: guardian.lastName,
        phone: guardian.phone,
        secondaryPhone: guardian.secondaryPhone,
        whatsappPhone: guardian.whatsappPhone,
        email: guardian.email,
        nationalId: guardian.nationalId,
        relationship: guardian.relationship,
        address: guardian.address,
        occupation: guardian.occupation,
        employer: guardian.employer,
        isFinancialContact: guardian.isFinancialContact ? 1 : 0,
        childCount: guardian.studentGuardians.length,
        children: children.length ? children.join(", ") : null,
      };
    });
    let relationships: unknown[] = [];
    if (guardianId) {
      const guardian = guardians.find((item) => item.id === guardianId);
      if (!guardian) return Response.json({ error: "Guardian not found." }, { status: 404 });
      const links = await db.studentGuardian.findMany({
        where: {
          guardianId,
          guardian: { schoolId: context.schoolId },
          student: { schoolId: context.schoolId },
        },
        include: {
          student: {
            select: {
              admissionNumber: true,
              firstName: true,
              lastName: true,
              classroom: { select: { name: true } },
            },
          },
        },
        orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
      });
      relationships = links.map((link) => ({
        studentId: link.studentId,
        admissionNumber: link.student.admissionNumber,
        firstName: link.student.firstName,
        lastName: link.student.lastName,
        classroomName: link.student.classroom?.name ?? null,
        relationshipType: link.relationshipType,
        isPrimaryContact: link.isPrimaryContact ? 1 : 0,
        authorizedPickup: link.authorizedPickup ? 1 : 0,
      }));
    }
    return Response.json({ guardians, relationships, permissions: { create: hasPermission(context.role, "guardians.create"), update: hasPermission(context.role, "guardians.update") } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await getSchoolContext(request);
    const raw = await request.json();
    const action = z.object({ action: z.string() }).parse(raw).action;
    const db = getDb();
    if (action === "create") {
      requirePermission(context, "guardians.create");
      const input = guardianInput.parse(raw); const id = crypto.randomUUID();
      await db.guardian.create({
        data: {
          id,
          schoolId: context.schoolId,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          secondaryPhone: input.secondaryPhone || null,
          whatsappPhone: input.whatsappPhone || null,
          email: input.email || null,
          nationalId: input.nationalId || null,
          relationship: input.relationship,
          address: input.address || null,
          occupation: input.occupation || null,
          employer: input.employer || null,
          isFinancialContact: input.isFinancialContact,
        },
      });
      await audit(db, context, "guardian.created", id, { name: `${input.firstName} ${input.lastName}` });
      return Response.json({ id }, { status: 201 });
    }
    if (action === "update") {
      requirePermission(context, "guardians.update");
      const input = guardianInput.extend({ guardianId: uuid }).parse(raw);
      const before = await db.guardian.findFirst({
        where: { id: input.guardianId, schoolId: context.schoolId },
        select: { firstName: true, lastName: true, phone: true, email: true },
      });
      if (!before) return Response.json({ error: "Guardian not found." }, { status: 404 });
      await db.guardian.update({
        where: { id: input.guardianId, schoolId: context.schoolId },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          secondaryPhone: input.secondaryPhone || null,
          whatsappPhone: input.whatsappPhone || null,
          email: input.email || null,
          nationalId: input.nationalId || null,
          relationship: input.relationship,
          address: input.address || null,
          occupation: input.occupation || null,
          employer: input.employer || null,
          isFinancialContact: input.isFinancialContact,
        },
      });
      await audit(db, context, "guardian.updated", input.guardianId, { before });
      return Response.json({ updated: true });
    }
    requirePermission(context, "guardians.update");
    const input = z.object({ action: z.literal("update_relationship"), guardianId: uuid, studentId: uuid, relationshipType: z.string().trim().min(2).max(40), isPrimaryContact: z.boolean(), authorizedPickup: z.boolean() }).parse(raw);
    const link = await db.studentGuardian.findFirst({
      where: {
        guardianId: input.guardianId,
        studentId: input.studentId,
        student: { schoolId: context.schoolId },
        guardian: { schoolId: context.schoolId },
      },
      select: { studentId: true, guardianId: true },
    });
    if (!link) return Response.json({ error: "Guardian relationship not found." }, { status: 404 });
    await db.studentGuardian.update({
      where: { studentId_guardianId: { studentId: input.studentId, guardianId: input.guardianId } },
      data: {
        relationshipType: input.relationshipType,
        isPrimaryContact: input.isPrimaryContact,
        authorizedPickup: input.authorizedPickup,
      },
    });
    await audit(db, context, "guardian.relationship_updated", input.guardianId, { studentId: input.studentId, relationshipType: input.relationshipType, authorizedPickup: input.authorizedPickup });
    return Response.json({ updated: true });
  } catch (error) { return errorResponse(error); }
}

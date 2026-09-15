import path from "node:path";
import { z } from "zod";
import { getDb } from "@/db";
import { getSchoolContext, guardMutation, requirePermission } from "@/lib/request-context";
import { hasPermission } from "@/lib/permissions";
import { getStudentDocument, putStudentDocument, removeStudentDocument } from "@/lib/document-storage";

const DOCUMENT_TYPES = ["birth_certificate", "medical", "previous_report", "transfer_letter", "guardian_id", "photo", "other"] as const;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string[]> = { ".pdf": ["application/pdf"], ".png": ["image/png"], ".jpg": ["image/jpeg"], ".jpeg": ["image/jpeg"], ".webp": ["image/webp"] };

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "document";
}

function routeError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return Response.json({ error: "Please check the document details." }, { status: 400 });
  return Response.json({ error: "The document request could not be completed." }, { status: 500 });
}

// Identity, health and transfer evidence need explicit records access. They
// are not ordinary classroom documents just because they belong to a learner.
const SENSITIVE_TYPES = new Set(["birth_certificate", "medical", "transfer_letter", "guardian_id", "photo"]);

function hasExpectedSignature(extension: string, bytes: Uint8Array) {
  if (extension === ".pdf") return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (extension === ".png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (extension === ".jpg" || extension === ".jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === ".webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

export async function GET(request: Request) {
  try {
    const context = await getSchoolContext(request);
    requirePermission(context, "documents.view");
    const canViewClinic = hasPermission(context.role, "clinic.view");
    const canManageDocuments = hasPermission(context.role, "students.manage-documents") || hasPermission(context.role, "documents.upload");
    const hiddenDocumentTypes = canManageDocuments
      ? []
      : [...SENSITIVE_TYPES].filter((type) => !(canViewClinic && type === "medical"));
    const db = getDb();
    const url = new URL(request.url);
    const downloadId = url.searchParams.get("download");

    if (downloadId) {
      const document = await db.studentDocument.findFirst({
        where: { id: downloadId, schoolId: context.schoolId },
        select: { id: true, filename: true, storageKey: true, contentType: true, documentType: true },
      });
      if (!document) return Response.json({ error: "Document not found." }, { status: 404 });
      if (SENSITIVE_TYPES.has(document.documentType) && !(canManageDocuments || (document.documentType === "medical" && canViewClinic))) {
        return Response.json({ error: "You are not permitted to view this sensitive document." }, { status: 403 });
      }
      try {
        const data = await getStudentDocument(document.storageKey);
        return new Response(new Uint8Array(data), {
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
            "Content-Disposition": `attachment; filename="${safeFilename(document.filename)}"`,
          },
        });
      } catch {
        return Response.json({ error: "The stored file is missing." }, { status: 404 });
      }
    }

    // School-wide register — every filed document, for staff who manage records.
    const studentIdParam = url.searchParams.get("studentId");
    if (!studentIdParam) {
      requirePermission(context, "documents.view");
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize")) || 25));
      const typeFilter = url.searchParams.get("type");
      const query = (url.searchParams.get("q") ?? "").trim();
      const where = {
        schoolId: context.schoolId,
        ...(typeFilter && (DOCUMENT_TYPES as readonly string[]).includes(typeFilter) ? { documentType: typeFilter } : {}),
        ...(hiddenDocumentTypes.length ? { documentType: { notIn: hiddenDocumentTypes } } : {}),
        ...(query
          ? {
              OR: [
                { filename: { contains: query, mode: "insensitive" as const } },
                { student: { OR: [{ firstName: { contains: query, mode: "insensitive" as const } }, { lastName: { contains: query, mode: "insensitive" as const } }, { admissionNumber: { contains: query, mode: "insensitive" as const } }] } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.studentDocument.findMany({
          where,
          select: {
            id: true, documentType: true, filename: true, contentType: true, byteSize: true, notes: true, createdAt: true,
            uploadedBy: { select: { displayName: true } },
            student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true, classroom: { select: { name: true } } } },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.studentDocument.count({ where }),
      ]);
      return Response.json({
        documents: rows.map((row) => ({
          id: row.id,
          documentType: row.documentType,
          filename: row.filename,
          contentType: row.contentType,
          byteSize: row.byteSize,
          notes: row.notes,
          createdAt: row.createdAt,
          uploadedBy: row.uploadedBy?.displayName ?? "—",
          studentId: row.student.id,
          studentName: `${row.student.firstName} ${row.student.lastName}`,
          admissionNumber: row.student.admissionNumber,
          classroomName: row.student.classroom?.name ?? null,
        })),
        total,
        page,
        pageSize,
        permissions: { upload: canManageDocuments, viewSensitive: canManageDocuments || canViewClinic },
      });
    }

    const studentId = z.string().min(1).max(64).parse(studentIdParam);
    const owned = await db.student.findFirst({
      where: { id: studentId, schoolId: context.schoolId },
      select: { id: true },
    });
    if (!owned) return Response.json({ error: "Student record not found." }, { status: 404 });

    const documents = await db.studentDocument.findMany({
      where: {
        studentId,
        schoolId: context.schoolId,
        ...(hiddenDocumentTypes.length ? { documentType: { notIn: hiddenDocumentTypes } } : {}),
      },
      select: {
        id: true, documentType: true, filename: true, contentType: true, byteSize: true, notes: true, createdAt: true,
        uploadedBy: { select: { displayName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return Response.json({
      documents,
      permissions: { manage: canManageDocuments },
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    await guardMutation(request, "documents");
    const context = await getSchoolContext(request);
    if (!hasPermission(context.role, "students.manage-documents") && !hasPermission(context.role, "documents.upload")) {
      throw new Response("You are not permitted to upload student documents.", { status: 403 });
    }
    const db = getDb();

    const form = await request.formData();
    const file = form.get("file");
    const studentId = z.string().min(1).max(64).parse(form.get("studentId"));
    const documentType = z.enum(DOCUMENT_TYPES).parse(form.get("documentType"));
    const notes = z.string().trim().max(300).optional().parse(form.get("notes") || undefined);

    if (SENSITIVE_TYPES.has(documentType) && !hasPermission(context.role, "clinic.view")) {
      return Response.json({ error: "Medical documents can only be filed by staff with clinic access." }, { status: 403 });
    }

    if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
    const extension = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    const allowedMimes = ALLOWED_TYPES[extension];
    if (!allowedMimes || !allowedMimes.includes((file.type || "").toLowerCase())) {
      return Response.json({ error: "Only PDF and image files (PNG, JPG, WEBP) can be uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) return Response.json({ error: "Files must be 5 MB or smaller." }, { status: 400 });
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    if (!hasExpectedSignature(extension, fileBytes)) return Response.json({ error: "The file contents do not match its declared type." }, { status: 400 });

    const student = await db.student.findFirst({
      where: { id: studentId, schoolId: context.schoolId, archivedAt: null },
      select: { id: true },
    });
    if (!student) return Response.json({ error: "Student record not found." }, { status: 404 });

    const documentId = crypto.randomUUID();
    const storageKey = path.posix.join(context.schoolId, `${documentId}-${safeFilename(file.name)}`);
    await putStudentDocument(storageKey, fileBytes, allowedMimes[0]);

    await db.$transaction([
      db.studentDocument.create({
        data: {
          id: documentId,
          studentId,
          schoolId: context.schoolId,
          documentType,
          filename: safeFilename(file.name),
          storageKey,
          contentType: allowedMimes[0],
          byteSize: file.size,
          notes: notes || null,
          uploadedById: context.membershipId,
        },
      }),
      db.auditLog.create({
        data: {
          schoolId: context.schoolId,
          actorMembershipId: context.membershipId,
          action: "student.document_uploaded",
          entityType: "student_document",
          entityId: documentId,
          details: JSON.stringify({ studentId, documentType, filename: file.name, byteSize: file.size }),
        },
      }),
    ]);
    return Response.json({ id: documentId }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await guardMutation(request, "documents");
    const context = await getSchoolContext(request);
    if (!hasPermission(context.role, "students.manage-documents") && !hasPermission(context.role, "documents.upload")) {
      throw new Response("You are not permitted to delete student documents.", { status: 403 });
    }
    const db = getDb();
    const documentId = z.string().min(1).max(64).parse(new URL(request.url).searchParams.get("id"));
    const document = await db.studentDocument.findFirst({
      where: { id: documentId, schoolId: context.schoolId },
      select: { id: true, storageKey: true, studentId: true },
    });
    if (!document) return Response.json({ error: "Document not found." }, { status: 404 });
    await db.$transaction([
      db.studentDocument.delete({ where: { id: document.id } }),
      db.auditLog.create({
        data: {
          schoolId: context.schoolId,
          actorMembershipId: context.membershipId,
          action: "student.document_deleted",
          entityType: "student_document",
          entityId: document.id,
          details: JSON.stringify({ studentId: document.studentId }),
        },
      }),
    ]);
    await removeStudentDocument(document.storageKey).catch(() => undefined);
    return Response.json({ deleted: true });
  } catch (error) {
    return routeError(error);
  }
}

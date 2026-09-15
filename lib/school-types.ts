export type Workspace = {
  tenantId: string;
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  currency: string;
  timezone: string;
  enabledModules?: string[];
  membershipId: string;
  displayName: string;
  role: string;
};

export type DashboardData = {
  workspace: Workspace;
  schools?: Array<{ schoolId: string; schoolName: string; role: string; displayName: string }>;
  today: string;
  summary: {
    activeStudents: number;
    classes: number;
    gradeLevels: number;
    guardians: number;
    activeMemberships: number;
    admissionsThisMonth: number;
    submittedRegistersToday: number;
    totalRegistersToday: number;
  };
  academicYear: null | {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
  };
  classes: Array<{
    id: string;
    name: string;
    gradeName: string;
    capacity: number;
    enrolled: number;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string;
    actor: string;
  }>;
  notices?: Array<{
    id: string;
    title: string;
    body: string;
    publishedAt: string | null;
  }>;
};

export type Student = {
  id: string;
  admissionNumber: string;
  firstName: string;
  middleName: string | null;
  email: string | null;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  status: string;
  medicalAlert?: string | null;
  photoPath?: string | null;
  zimsecCandidateNumber?: string | null;
  classroomId: string | null;
  classroomName: string | null;
  admissionDate: string | null;
  createdAt: string;
  enrollments?: {
    yearName: string;
    gradeName: string;
    classroomName: string;
    status: string;
    enrollmentDate: string;
    exitDate: string | null;
    exitReason: string | null;
  }[];
  leaderships?: {
    id: string;
    title: string;
    scope: string;
    classroomName: string | null;
    active: boolean;
    startDate: string;
    endDate: string | null;
  }[];
};

export type Classroom = {
  id: string;
  name: string;
  academicYear: string;
  academicYearId?: string | null;
  yearStatus?: string | null;
  gradeLevelId?: string | null;
  gradeName: string | null;
  capacity: number;
};

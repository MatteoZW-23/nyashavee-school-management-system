// A learner's report cards unlock only when their outstanding balance is
// zero (or credit) in EVERY currency — USD and ZiG are checked separately
// so a paid USD invoice cannot mask a ZiG debt.
export type StudentBalance = {
  studentId: string;
  currency: string;
  outstandingMinor: number;
};

export function clearedStudentIds(studentIds: string[], balances: StudentBalance[]) {
  return new Set(
    studentIds.filter((id) =>
      balances
        .filter((balance) => balance.studentId === id)
        .every((balance) => balance.outstandingMinor <= 0),
    ),
  );
}

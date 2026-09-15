import { auth } from "@/auth";
import { SchoolApp } from "@/components/school-app";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <SchoolApp
      user={{
        displayName: session.user.name ?? "User",
        email: session.user.email ?? "",
      }}
    />
  );
}

/**
 * The Desktop edition is intentionally bound to the local computer. The
 * server uses this identity to resolve the seeded administrator membership.
 */
export const LOCAL_IDENTITY = {
  userId: "local_admin",
  displayName: "Tendai Moyo",
  email: "admin@nyashavee.local",
} as const;

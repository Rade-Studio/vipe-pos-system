import { signOutAndReload } from "@/lib/api/auth"

/** Same sign-out as the shared Header: revoke the API session, then a hard reload. */
export async function signOutAndLeave() {
  await signOutAndReload()
}

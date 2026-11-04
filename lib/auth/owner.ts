import type { User } from "@supabase/supabase-js";

export type ProviderIdentity = { provider: string; providerId: string };

/** True only for Mason's GitHub account (ownerGithubId defaults to HUB_OWNER_GITHUB_ID); no server imports so mobile can share it. */
export function isOwnerIdentity(identity: ProviderIdentity, ownerGithubId = process.env.HUB_OWNER_GITHUB_ID): boolean {
  if (!ownerGithubId || !/^\d+$/.test(ownerGithubId)) return false;
  return identity.provider === "github" && identity.providerId === ownerGithubId;
}

/** Checks the user's linked identities, never user_metadata, which the user can edit. */
export function isOwnerUser(user: User, ownerGithubId?: string): boolean {
  // Supabase sets identity.id to the provider's own user id (GitHub's numeric id).
  return (user.identities ?? []).some((identity) =>
    isOwnerIdentity({ provider: identity.provider, providerId: identity.id }, ownerGithubId),
  );
}

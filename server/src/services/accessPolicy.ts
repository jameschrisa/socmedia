import type { AccessPolicy, AllowedDomain } from "@socmedia/shared";
import type { Db } from "../db/database";
import { SettingsRepo } from "../db/repositories/settings";

const KEY = "access_policy";

/** Shipped default: enelhealth.com and f3insights.com self-serve as editors into their own org. */
export function defaultAccessPolicy(): AccessPolicy {
  return {
    domains: [
      { domain: "enelhealth.com", role: "editor", orgSlugs: ["enel-health"] },
      { domain: "f3insights.com", role: "editor", orgSlugs: ["f3i"] },
    ],
    allowInvitedUsersAnyDomain: true,
  };
}

export function getAccessPolicy(db: Db): AccessPolicy {
  const repo = new SettingsRepo(db);
  const stored = repo.get<AccessPolicy>(KEY);
  return stored?.value ?? defaultAccessPolicy();
}

export function saveAccessPolicy(db: Db, policy: AccessPolicy): AccessPolicy {
  const repo = new SettingsRepo(db);
  repo.set(KEY, policy);
  return policy;
}

export function domainOf(email: string): string {
  return (email.split("@")[1] || "").toLowerCase();
}

/** The allowed-domain entry matching `email`'s domain, if any. */
export function findAllowedDomain(policy: AccessPolicy, email: string): AllowedDomain | undefined {
  const domain = domainOf(email);
  return policy.domains.find((d) => d.domain === domain);
}

/** A human message naming the allowed domains, for 403s and the sign-in page. */
export function allowedDomainsMessage(policy: AccessPolicy): string {
  const domains = policy.domains.map((d) => d.domain);
  if (domains.length === 0) {
    return "Sign-in is by invitation only. Request access and an admin will set up your account.";
  }
  return `Sign-in is available for ${domains.join(", ")}. If you're outside those domains, request access and an admin will set up your account.`;
}

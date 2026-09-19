import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthProviders, AuthState, ChangePasswordInput, LoginInput, SetupInput } from "@socmedia/shared";
import { ROLE_CAPABILITIES } from "@socmedia/shared";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";

export type Capabilities = (typeof ROLE_CAPABILITIES)["owner"];
export type Capability = keyof Capabilities;

const NO_CAPABILITIES: Capabilities = { manageUsers: false, manageOrgs: false, manageSettings: false, write: false };

/** Sign-in page renders before we know what the server offers, so default to the one method every deployment has. */
const DEFAULT_PROVIDERS: AuthProviders = { password: true, magicLink: false, google: false };

const SIGNED_OUT: AuthState = { authenticated: false, needsSetup: false, user: null };

/**
 * Current session: who is signed in (if anyone) and what they're allowed to do.
 * Resilient to a missing or erroring `/auth/me` (treated as signed out) so pages
 * and tests that never stub it still render instead of throwing.
 */
export function useAuth() {
  const query = useQuery({
    queryKey: qk.auth,
    queryFn: api.auth.me,
    staleTime: 60_000,
    retry: false,
  });

  const state = query.data ?? SIGNED_OUT;
  const user = state.user ?? null;
  const can = user ? ROLE_CAPABILITIES[user.role] : NO_CAPABILITIES;

  return {
    ...query,
    user,
    authenticated: !!state.authenticated,
    needsSetup: !!state.needsSetup,
    isLoading: query.isLoading,
    can,
    providers: state.providers ?? DEFAULT_PROVIDERS,
    allowedDomains: state.allowedDomains ?? [],
  };
}

/** Small standalone accessor for features that only need capability checks. */
export function useCan(): Capabilities {
  return useAuth().can;
}

export function useAuthMutations() {
  const qc = useQueryClient();
  const setAuth = (state: AuthState) => qc.setQueryData<AuthState>(qk.auth, state);

  const login = useMutation({
    mutationFn: (input: LoginInput) => api.auth.login(input),
    onSuccess: setAuth,
  });

  const setup = useMutation({
    mutationFn: (input: SetupInput) => api.auth.setup(input),
    onSuccess: setAuth,
  });

  const changePassword = useMutation({
    mutationFn: (input: ChangePasswordInput) => api.auth.changePassword(input),
    onSuccess: () => {
      // The server clears mustChangePassword on success; mirror that locally.
      qc.setQueryData<AuthState>(qk.auth, (old) =>
        old?.user ? { ...old, user: { ...old.user, mustChangePassword: false } } : old,
      );
    },
  });

  const logout = useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      // Flip auth state first so the mounted observer re-renders to the sign-in page, then
      // drop every other cached query (media, posts, connections, ...) so nothing from the
      // previous session lingers. qc.clear() would detach the auth observer and leave the
      // dashboard on screen until a reload.
      qc.setQueryData<AuthState>(qk.auth, SIGNED_OUT);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== qk.auth[0] });
    },
  });

  return { login, setup, changePassword, logout };
}

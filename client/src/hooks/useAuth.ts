import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthState, ChangePasswordInput, LoginInput, SetupInput } from "@socmedia/shared";
import { ROLE_CAPABILITIES } from "@socmedia/shared";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";

export type Capabilities = (typeof ROLE_CAPABILITIES)["owner"];
export type Capability = keyof Capabilities;

const NO_CAPABILITIES: Capabilities = { manageUsers: false, manageOrgs: false, manageSettings: false, write: false };

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
      // Drop every cached org-scoped query (media, posts, connections, ...) before
      // resetting auth state, so nothing from the previous session lingers.
      qc.clear();
      qc.setQueryData<AuthState>(qk.auth, SIGNED_OUT);
    },
  });

  return { login, setup, changePassword, logout };
}

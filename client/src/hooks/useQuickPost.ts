import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublishMode, QuickPostPublicInfo, QuickPostToken } from "@socmedia/shared";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useCurrentOrgId } from "./useOrg";

/** Tokens for the signed-in org's "Quick post from your phone" links. */
export function useQuickTokens() {
  const orgId = useCurrentOrgId();
  return useQuery({ queryKey: qk.quickTokens(orgId), queryFn: api.quick.tokens, enabled: !!orgId });
}

export function useQuickTokenMutations() {
  const orgId = useCurrentOrgId();
  const qc = useQueryClient();
  const key = qk.quickTokens(orgId);
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: (input: { label: string; connectionIds: string[]; publishMode: PublishMode }) => api.quick.createToken(input),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ label: string; connectionIds: string[]; publishMode: PublishMode; active: boolean }> }) =>
      api.quick.updateToken(id, input),
    onSuccess: (token) => qc.setQueryData<QuickPostToken[]>(key, (old) => old?.map((t) => (t.id === token.id ? token : t))),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.quick.removeToken(id), onSuccess: invalidate });

  return { create, update, remove };
}

/** Public info for the `/go/:token` page: no session required. */
export function useQuickPostInfo(token: string | undefined) {
  return useQuery<QuickPostPublicInfo>({
    queryKey: qk.quickInfo(token ?? ""),
    queryFn: () => api.quick.info(token!),
    enabled: !!token,
    retry: false,
  });
}

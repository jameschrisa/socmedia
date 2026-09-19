import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Organization, OrganizationInput } from "@socmedia/shared";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useAppStore } from "@/store/appStore";

/** Loads organizations and guarantees a valid current org selection. */
export function useOrgs() {
  const query = useQuery({ queryKey: qk.orgs, queryFn: api.orgs.list });
  const currentOrgId = useAppStore((s) => s.currentOrgId);
  const setCurrentOrgId = useAppStore((s) => s.setCurrentOrgId);

  useEffect(() => {
    if (!query.data || query.isFetching) return;
    const exists = query.data.some((o) => o.id === currentOrgId);
    if (!exists) setCurrentOrgId(query.data[0]?.id ?? null);
  }, [query.data, currentOrgId, setCurrentOrgId]);

  const currentOrg: Organization | undefined = query.data?.find((o) => o.id === currentOrgId) ?? query.data?.[0];
  return { ...query, orgs: query.data ?? [], currentOrg, currentOrgId: currentOrg?.id ?? null, setCurrentOrgId };
}

export function useCurrentOrgId() {
  return useAppStore((s) => s.currentOrgId);
}

export function useOrgMutations() {
  const qc = useQueryClient();
  const setCurrentOrgId = useAppStore((s) => s.setCurrentOrgId);
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.orgs });
  const create = useMutation({
    mutationFn: (input: OrganizationInput) => api.orgs.create(input),
    onSuccess: (org) => {
      qc.setQueryData<Organization[]>(qk.orgs, (old) => (old ? [...old, org] : [org]));
      setCurrentOrgId(org.id);
      invalidate();
    },
  });
  const update = useMutation({ mutationFn: ({ id, input }: { id: string; input: Partial<OrganizationInput> }) => api.orgs.update(id, input), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api.orgs.remove(id), onSuccess: invalidate });
  const uploadLogo = useMutation({ mutationFn: ({ id, file }: { id: string; file: File }) => api.orgs.uploadLogo(id, file), onSuccess: invalidate });
  const removeLogo = useMutation({ mutationFn: (id: string) => api.orgs.removeLogo(id), onSuccess: invalidate });
  return { create, update, remove, uploadLogo, removeLogo };
}

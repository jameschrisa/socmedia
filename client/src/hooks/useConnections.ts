import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectionCreateInput, ConnectionUpdateInput, PlatformConnection } from "@socmedia/shared";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useCurrentOrgId } from "./useOrg";

export function useConnections() {
  const orgId = useCurrentOrgId();
  return useQuery({ queryKey: qk.connections(orgId), queryFn: api.connections.list, enabled: !!orgId });
}

export function useConnectionMutations() {
  const orgId = useCurrentOrgId();
  const qc = useQueryClient();
  const key = qk.connections(orgId);
  const replace = (conn: PlatformConnection) =>
    qc.setQueryData<PlatformConnection[]>(key, (old) => (old ? old.map((c) => (c.id === conn.id ? conn : c)) : old));

  const update = useMutation({ mutationFn: ({ id, input }: { id: string; input: ConnectionUpdateInput }) => api.connections.update(id, input), onSuccess: replace });
  const test = useMutation({ mutationFn: (id: string) => api.connections.test(id), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const connect = useMutation({
    mutationFn: (id: string) => api.connections.connect(id),
    onSuccess: (res) => { if (res.connection) replace(res.connection); else qc.invalidateQueries({ queryKey: key }); },
  });
  const disconnect = useMutation({ mutationFn: (id: string) => api.connections.disconnect(id), onSuccess: replace });
  const refresh = useMutation({ mutationFn: (id: string) => api.connections.refresh(id), onSuccess: replace });
  const create = useMutation({ mutationFn: (input: ConnectionCreateInput) => api.connections.create(input), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const remove = useMutation({ mutationFn: (id: string) => api.connections.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  return { update, test, connect, disconnect, refresh, create, remove };
}

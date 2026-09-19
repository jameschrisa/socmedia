import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Platform, PostInput, PostUpdateInput } from "@socmedia/shared";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useCurrentOrgId } from "./useOrg";

export function usePosts(params: { from?: string; to?: string; status?: string[]; platform?: Platform; includeUnscheduled?: boolean } = {}) {
  const orgId = useCurrentOrgId();
  return useQuery({ queryKey: [...qk.posts(orgId, { from: params.from, to: params.to }), params.status ?? [], params.platform ?? "", !!params.includeUnscheduled], queryFn: () => api.posts.list(params), enabled: !!orgId });
}

export function usePost(id: string | null) {
  const orgId = useCurrentOrgId();
  return useQuery({ queryKey: qk.post(orgId, id ?? ""), queryFn: () => api.posts.get(id!), enabled: !!orgId && !!id });
}

export function usePostMutations() {
  const orgId = useCurrentOrgId();
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["posts", orgId] });
    qc.invalidateQueries({ queryKey: ["post", orgId] });
    qc.invalidateQueries({ queryKey: ["jobs", orgId] });
  };
  const create = useMutation({ mutationFn: (input: PostInput) => api.posts.create(input), onSuccess: invalidate });
  const update = useMutation({ mutationFn: ({ id, input }: { id: string; input: PostUpdateInput }) => api.posts.update(id, input), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api.posts.remove(id), onSuccess: invalidate });
  const schedule = useMutation({ mutationFn: ({ id, scheduledAt }: { id: string; scheduledAt: string }) => api.posts.schedule(id, scheduledAt), onSuccess: invalidate });
  const publish = useMutation({ mutationFn: (id: string) => api.posts.publish(id), onSuccess: invalidate });
  const duplicate = useMutation({ mutationFn: (id: string) => api.posts.duplicate(id), onSuccess: invalidate });
  const approve = useMutation({ mutationFn: (id: string) => api.posts.approve(id), onSuccess: invalidate });
  return { create, update, remove, schedule, publish, duplicate, approve, invalidate };
}

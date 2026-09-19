import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useCurrentOrgId } from "./useOrg";

export function useMedia() {
  const orgId = useCurrentOrgId();
  return useQuery({ queryKey: qk.media(orgId), queryFn: api.media.list, enabled: !!orgId });
}

export function useMediaMutations() {
  const orgId = useCurrentOrgId();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.media(orgId) });
  const upload = useMutation({ mutationFn: ({ file, extra }: { file: File; extra?: { tags?: string[]; sourceAssetId?: string; format?: string } }) => api.media.upload(file, extra), onSuccess: invalidate });
  const exportDataUrl = useMutation({ mutationFn: api.media.exportDataUrl, onSuccess: invalidate });
  const update = useMutation({ mutationFn: ({ id, tags }: { id: string; tags: string[] }) => api.media.update(id, { tags }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api.media.remove(id), onSuccess: invalidate });
  return { upload, exportDataUrl, update, remove };
}

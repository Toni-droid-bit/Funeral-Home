import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertCall } from "@shared/schema";

export function useCalls() {
  return useQuery({
    queryKey: [api.calls.list.path],
    queryFn: async () => {
      const res = await fetch(api.calls.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch calls");
      return api.calls.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateCall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertCall) => {
      const res = await fetch(api.calls.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to log call");
      return api.calls.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.calls.list.path] });
    },
  });
}

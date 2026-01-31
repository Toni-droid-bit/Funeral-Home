import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertMeeting } from "@shared/schema";

export function useMeetings() {
  return useQuery({
    queryKey: [api.meetings.list.path],
    queryFn: async () => {
      const res = await fetch(api.meetings.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch meetings");
      return api.meetings.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateMeeting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertMeeting) => {
      const res = await fetch(api.meetings.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create meeting");
      return api.meetings.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.meetings.list.path] });
    },
  });
}

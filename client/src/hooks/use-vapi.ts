import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";

interface VapiPhoneNumber {
  id: string;
  number: string;
  name?: string;
  provider?: string;
}

interface VapiAssistant {
  id: string;
  name: string;
}

interface MakeCallParams {
  phoneNumberId: string;
  customerNumber: string;
  customerName?: string;
  assistantId?: string;
  caseId?: number;
  firstMessage?: string;
}

export function useVapiPhoneNumbers() {
  return useQuery<VapiPhoneNumber[]>({
    queryKey: ["/api/vapi/phone-numbers"],
    queryFn: async () => {
      const res = await fetch("/api/vapi/phone-numbers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch phone numbers");
      return res.json();
    },
  });
}

export function useVapiAssistants() {
  return useQuery<VapiAssistant[]>({
    queryKey: ["/api/vapi/assistants"],
    queryFn: async () => {
      const res = await fetch("/api/vapi/assistants", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch assistants");
      return res.json();
    },
  });
}

export function useMakeCall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: MakeCallParams) => {
      const res = await fetch("/api/vapi/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to make call");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.calls.list.path] });
    },
  });
}

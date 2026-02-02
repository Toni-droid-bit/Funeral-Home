import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useVapiPhoneNumbers, useVapiAssistants, useMakeCall } from "@/hooks/use-vapi";
import { useCases } from "@/hooks/use-cases";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PhoneCall, Loader2 } from "lucide-react";
import { z } from "zod";

const formSchema = z.object({
  phoneNumberId: z.string().min(1, "Please select a phone number"),
  customerNumber: z.string().min(1, "Please enter a phone number to call").regex(/^\+?[\d\s-()]+$/, "Invalid phone number format"),
  customerName: z.string().optional(),
  assistantId: z.string().optional(),
  caseId: z.string().optional(),
  firstMessage: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface MakeCallDialogProps {
  trigger?: React.ReactNode;
}

export function MakeCallDialog({ trigger }: MakeCallDialogProps) {
  const [open, setOpen] = useState(false);
  const { data: phoneNumbers, isLoading: loadingPhones } = useVapiPhoneNumbers();
  const { data: assistants, isLoading: loadingAssistants } = useVapiAssistants();
  const { data: cases } = useCases();
  const { mutateAsync: makeCall, isPending } = useMakeCall();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      phoneNumberId: "",
      customerNumber: "",
      customerName: "",
      assistantId: "",
      caseId: "",
      firstMessage: "",
    },
  });

  async function onSubmit(data: FormValues) {
    try {
      await makeCall({
        phoneNumberId: data.phoneNumberId,
        customerNumber: data.customerNumber,
        customerName: data.customerName || undefined,
        assistantId: data.assistantId || undefined,
        caseId: data.caseId ? parseInt(data.caseId) : undefined,
        firstMessage: data.firstMessage || undefined,
      });
      toast({
        title: "Call Initiated",
        description: `Calling ${data.customerNumber}...`,
      });
      setOpen(false);
      form.reset();
    } catch (error: any) {
      toast({
        title: "Call Failed",
        description: error.message || "Failed to initiate call. Please try again.",
        variant: "destructive",
      });
    }
  }

  const isLoading = loadingPhones || loadingAssistants;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button data-testid="button-make-call" className="bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <PhoneCall className="w-4 h-4 mr-2" />
            Make Call
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Make AI Call</DialogTitle>
          <DialogDescription>
            Initiate an AI-powered outbound call using Vapi.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <FormField
                control={form.control}
                name="phoneNumberId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>From Number</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-from-number">
                          <SelectValue placeholder="Select your Vapi phone number" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {phoneNumbers?.map((phone) => (
                          <SelectItem key={phone.id} value={phone.id}>
                            {phone.number} {phone.name ? `(${phone.name})` : ""}
                          </SelectItem>
                        ))}
                        {(!phoneNumbers || phoneNumbers.length === 0) && (
                          <SelectItem value="no-numbers" disabled>
                            No phone numbers configured
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="customerNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Call To</FormLabel>
                    <FormControl>
                      <Input 
                        data-testid="input-to-number"
                        placeholder="+1 555 123 4567" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="customerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Name (Optional)</FormLabel>
                    <FormControl>
                      <Input 
                        data-testid="input-contact-name"
                        placeholder="Name of person being called" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="assistantId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>AI Assistant (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-assistant">
                          <SelectValue placeholder="Use default funeral assistant" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="">Default Funeral Assistant</SelectItem>
                        {assistants?.map((assistant) => (
                          <SelectItem key={assistant.id} value={assistant.id}>
                            {assistant.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="caseId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Link to Case (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-case">
                          <SelectValue placeholder="Select a case" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="">No case linked</SelectItem>
                        {cases?.map((c) => (
                          <SelectItem key={c.id} value={c.id.toString()}>
                            {c.deceasedName} - {c.status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="firstMessage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Opening Message (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        data-testid="input-first-message"
                        placeholder="Custom greeting for this call..."
                        className="resize-none min-h-[80px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setOpen(false)}
                  data-testid="button-cancel-call"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={isPending}
                  data-testid="button-initiate-call"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <PhoneCall className="w-4 h-4 mr-2" />
                      Start Call
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

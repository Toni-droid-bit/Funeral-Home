import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Trash2, GripVertical, Save, AlertCircle, CheckCircle, Clock } from "lucide-react";

type Category = "critical" | "important" | "supplementary";

interface ChecklistItem {
  id: string;
  question: string;
  category: Category;
  fieldMapping?: string;
  isCustom: boolean;
}

interface ChecklistTemplate {
  id: number;
  name: string;
  description?: string;
  isDefault: boolean;
  items: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_CONFIG = {
  critical: { 
    label: "Critical", 
    description: "Must have before family leaves",
    icon: AlertCircle,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950",
    badgeVariant: "destructive" as const,
  },
  important: { 
    label: "Important", 
    description: "Should confirm during meeting",
    icon: CheckCircle,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950",
    badgeVariant: "secondary" as const,
  },
  supplementary: { 
    label: "Supplementary", 
    description: "Can follow up later",
    icon: Clock,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950",
    badgeVariant: "outline" as const,
  },
};

export default function ChecklistSettings() {
  const { toast } = useToast();
  const [editingTemplate, setEditingTemplate] = useState<ChecklistTemplate | null>(null);
  const [newItemQuestion, setNewItemQuestion] = useState("");
  const [newItemCategory, setNewItemCategory] = useState<Category>("important");

  const { data: templates = [], isLoading } = useQuery<ChecklistTemplate[]>({
    queryKey: ["/api/checklist-templates"],
  });

  const updateMutation = useMutation({
    mutationFn: async (template: ChecklistTemplate) => {
      return apiRequest("PUT", `/api/checklist-templates/${template.id}`, {
        name: template.name,
        description: template.description,
        items: template.items,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/checklist-templates"] });
      toast({ title: "Checklist saved", description: "Your changes have been saved." });
      setEditingTemplate(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save checklist.", variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (template: { name: string; description?: string; items: ChecklistItem[] }) => {
      return apiRequest("POST", "/api/checklist-templates", template);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/checklist-templates"] });
      toast({ title: "Checklist created", description: "New checklist template created." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create checklist.", variant: "destructive" });
    },
  });

  const startEditing = (template: ChecklistTemplate) => {
    setEditingTemplate({ ...template, items: [...template.items] });
  };

  const addItem = () => {
    if (!editingTemplate || !newItemQuestion.trim()) return;
    
    const newItem: ChecklistItem = {
      id: `custom-${Date.now()}`,
      question: newItemQuestion.trim(),
      category: newItemCategory,
      isCustom: true,
    };
    
    setEditingTemplate({
      ...editingTemplate,
      items: [...editingTemplate.items, newItem],
    });
    setNewItemQuestion("");
  };

  const removeItem = (itemId: string) => {
    if (!editingTemplate) return;
    setEditingTemplate({
      ...editingTemplate,
      items: editingTemplate.items.filter(item => item.id !== itemId),
    });
  };

  const updateItemCategory = (itemId: string, category: Category) => {
    if (!editingTemplate) return;
    setEditingTemplate({
      ...editingTemplate,
      items: editingTemplate.items.map(item =>
        item.id === itemId ? { ...item, category } : item
      ),
    });
  };

  const updateItemQuestion = (itemId: string, question: string) => {
    if (!editingTemplate) return;
    setEditingTemplate({
      ...editingTemplate,
      items: editingTemplate.items.map(item =>
        item.id === itemId ? { ...item, question } : item
      ),
    });
  };

  const getItemsByCategory = (items: ChecklistItem[], category: Category) => {
    return items.filter(item => item.category === category);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-muted rounded" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  const activeTemplate = editingTemplate || templates[0];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="heading-checklist-settings">Checklist Settings</h1>
          <p className="text-muted-foreground">
            Customize the questions asked during arrangement meetings
          </p>
        </div>
        {editingTemplate && (
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => setEditingTemplate(null)}
              data-testid="button-cancel-edit"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => updateMutation.mutate(editingTemplate)}
              disabled={updateMutation.isPending}
              data-testid="button-save-checklist"
            >
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          </div>
        )}
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">No checklist templates found.</p>
            <Button 
              onClick={() => createMutation.mutate({
                name: "My Checklist",
                description: "Custom checklist for arrangement meetings",
                items: [],
              })}
              data-testid="button-create-template"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {!editingTemplate && (
            <div className="flex gap-2 flex-wrap">
              {templates.map(template => (
                <Card 
                  key={template.id} 
                  className="cursor-pointer hover-elevate"
                  onClick={() => startEditing(template)}
                  data-testid={`card-template-${template.id}`}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {template.name}
                      {template.isDefault && <Badge variant="secondary">Default</Badge>}
                    </CardTitle>
                    <CardDescription>
                      {template.items.length} questions
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{template.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {activeTemplate && editingTemplate && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Template Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Template Name</Label>
                    <Input
                      value={editingTemplate.name}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                      data-testid="input-template-name"
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={editingTemplate.description || ""}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
                      data-testid="input-template-description"
                    />
                  </div>
                </CardContent>
              </Card>

              {(["critical", "important", "supplementary"] as Category[]).map(category => {
                const config = CATEGORY_CONFIG[category];
                const items = getItemsByCategory(editingTemplate.items, category);
                const Icon = config.icon;
                
                return (
                  <Card key={category} className={config.bgColor}>
                    <CardHeader>
                      <CardTitle className={`flex items-center gap-2 ${config.color}`}>
                        <Icon className="w-5 h-5" />
                        {config.label}
                        <Badge variant={config.badgeVariant}>{items.length}</Badge>
                      </CardTitle>
                      <CardDescription>{config.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {items.map((item, index) => (
                        <div 
                          key={item.id} 
                          className="flex items-center gap-2 p-2 bg-background rounded-md"
                          data-testid={`checklist-item-${item.id}`}
                        >
                          <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                          <Input
                            value={item.question}
                            onChange={(e) => updateItemQuestion(item.id, e.target.value)}
                            className="flex-1"
                            data-testid={`input-question-${item.id}`}
                          />
                          <Select 
                            value={item.category} 
                            onValueChange={(v) => updateItemCategory(item.id, v as Category)}
                          >
                            <SelectTrigger className="w-36" data-testid={`select-category-${item.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="critical">Critical</SelectItem>
                              <SelectItem value="important">Important</SelectItem>
                              <SelectItem value="supplementary">Supplementary</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => removeItem(item.id)}
                            data-testid={`button-remove-${item.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                      {items.length === 0 && (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No questions in this category
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              <Card>
                <CardHeader>
                  <CardTitle>Add New Question</CardTitle>
                  <CardDescription>Add a custom question to your checklist</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter your question..."
                      value={newItemQuestion}
                      onChange={(e) => setNewItemQuestion(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addItem()}
                      className="flex-1"
                      data-testid="input-new-question"
                    />
                    <Select 
                      value={newItemCategory} 
                      onValueChange={(v) => setNewItemCategory(v as Category)}
                    >
                      <SelectTrigger className="w-36" data-testid="select-new-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="critical">Critical</SelectItem>
                        <SelectItem value="important">Important</SelectItem>
                        <SelectItem value="supplementary">Supplementary</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={addItem} data-testid="button-add-question">
                      <Plus className="w-4 h-4 mr-2" />
                      Add
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

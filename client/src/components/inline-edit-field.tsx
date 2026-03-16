import { useState, useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";

interface InlineEditFieldProps {
  value: string | undefined | null;
  onSave: (value: string) => Promise<void> | void;
  placeholder?: string;
  label?: string;
  className?: string;
  displayClassName?: string;
  inputClassName?: string;
  multiline?: boolean;
}

export function InlineEditField({
  value,
  onSave,
  placeholder = "—",
  label,
  className = "",
  displayClassName = "",
  inputClassName = "",
  multiline = false,
}: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEdit = () => {
    setDraft(value || "");
    setEditing(true);
  };

  useEffect(() => {
    if (editing) {
      if (multiline) textareaRef.current?.focus();
      else inputRef.current?.focus();
    }
  }, [editing, multiline]);

  const handleSave = async () => {
    setEditing(false);
    if (draft !== (value || "")) {
      setSaving(true);
      try {
        await onSave(draft);
      } finally {
        setSaving(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSave();
    else if (e.key === "Escape") setEditing(false);
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      setEditing(false);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className={`group ${className}`}>
      {label && (
        <p className="text-xs font-medium text-muted-foreground mb-0.5">{label}</p>
      )}
      {editing ? (
        multiline ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleTextareaKeyDown}
            placeholder={placeholder}
            rows={4}
            className={`w-full bg-transparent border border-primary rounded focus:outline-none text-sm p-2 resize-y ${inputClassName}`}
          />
        ) : (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={`w-full bg-transparent border-b border-primary focus:outline-none text-sm py-0.5 ${inputClassName}`}
          />
        )
      ) : saving ? (
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{value || placeholder}</span>
        </span>
      ) : multiline ? (
        <div
          onClick={startEdit}
          title="Click to edit"
          className={`cursor-pointer text-sm rounded p-2 bg-muted/30 leading-relaxed min-h-[3rem] hover:ring-1 hover:ring-primary/40 transition-shadow whitespace-pre-wrap ${
            !value ? "text-muted-foreground/50 italic" : ""
          } ${displayClassName}`}
        >
          {value || placeholder}
        </div>
      ) : (
        <span
          onClick={startEdit}
          title="Click to edit"
          className={`cursor-pointer text-sm hover:text-primary hover:underline decoration-dashed underline-offset-2 ${
            !value ? "text-muted-foreground/50 italic" : ""
          } ${displayClassName}`}
        >
          {value || placeholder}
        </span>
      )}
    </div>
  );
}

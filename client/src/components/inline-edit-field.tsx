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
}

export function InlineEditField({
  value,
  onSave,
  placeholder = "—",
  label,
  className = "",
  displayClassName = "",
  inputClassName = "",
}: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(value || "");
    setEditing(true);
  };

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

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

  return (
    <div className={`group ${className}`}>
      {label && (
        <p className="text-xs font-medium text-muted-foreground mb-0.5">{label}</p>
      )}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`w-full bg-transparent border-b border-primary focus:outline-none text-sm py-0.5 ${inputClassName}`}
        />
      ) : saving ? (
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{value || placeholder}</span>
        </span>
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

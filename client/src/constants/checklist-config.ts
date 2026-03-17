export const CATEGORY_CONFIG: Record<string, {
  label: string;
  color: string;
  bgColor: string;
  iconColor: string;
}> = {
  critical: {
    label: "Critical",
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-900/20",
    iconColor: "text-red-500",
  },
  important: {
    label: "Important",
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
    iconColor: "text-amber-500",
  },
  supplementary: {
    label: "Supplementary",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
    iconColor: "text-blue-500",
  },
};

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "pl", label: "Polish" },
  { code: "ro", label: "Romanian" },
  { code: "hi", label: "Hindi / Punjabi" },
  { code: "zh", label: "Chinese (Mandarin)" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "tr", label: "Turkish" },
  { code: "nl", label: "Dutch" },
];

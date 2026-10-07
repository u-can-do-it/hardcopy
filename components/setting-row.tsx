import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface SettingRowProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** One labelled toggle. Shared by the popup and the options page. */
export function SettingRow({
  id,
  label,
  description,
  checked,
  disabled = false,
  onCheckedChange,
}: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-1">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        {description ? (
          <p className="text-muted-foreground text-xs leading-snug">{description}</p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}

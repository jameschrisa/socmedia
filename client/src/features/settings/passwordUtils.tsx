import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button, Input } from "@/components/ui";

/** Random temporary password for invites and admin-issued resets. Not cryptographically
 * unguessable on its own; the user is always forced to change it at first sign-in. */
export function generatePassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 0xffffffff);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Couldn't copy. Select the password and copy it manually.");
  }
}

/** One-time reveal of a temporary/generated password, with a copy button. Used anywhere a
 * server hands back a plaintext password that will never be shown again. */
export function TemporaryPasswordReveal({ password, note }: { password: string; note: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input readOnly value={password} className="font-mono" aria-label="Temporary password" onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => copyToClipboard(password)} autoFocus>Copy</Button>
      </div>
      <p className="notice-warning" role="status">{note} It won't be shown again.</p>
    </div>
  );
}

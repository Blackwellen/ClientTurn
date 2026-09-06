"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  createLogoUploadUrl,
  removeBusinessLogo,
  saveBusinessLogo,
} from "@/lib/settings/actions";

/**
 * The logo is a stored object, not a draft field: it uploads to R2 through a
 * short-lived signed URL and commits on its own, so it is never held in the
 * form's dirty state. The previous logo stays in place until the new one is
 * saved successfully.
 */
export function LogoUploader({
  businessName,
  logoUrl,
  hasLogo,
  readOnly,
  onLogoChange,
}: {
  businessName: string;
  logoUrl: string | null;
  hasLogo: boolean;
  readOnly: boolean;
  /** Lets the live preview swap immediately, before the server round-trip. */
  onLogoChange?: (previewUrl: string | null) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    const prepared = await createLogoUploadUrl({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    });

    if (!prepared.ok) {
      setBusy(false);
      toast({
        variant: "error",
        title: "Logo not uploaded",
        description: prepared.error,
      });
      return;
    }

    try {
      const response = await fetch(prepared.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!response.ok) throw new Error("upload failed");
    } catch {
      setBusy(false);
      toast({
        variant: "error",
        title: "Logo not uploaded",
        description:
          "The file could not be sent. Check your connection and try again.",
      });
      return;
    }

    const saved = await saveBusinessLogo(prepared.key);
    setBusy(false);

    if (saved.ok) {
      onLogoChange?.(URL.createObjectURL(file));
      toast({ variant: "success", title: "Logo updated" });
      router.refresh();
    } else {
      toast({
        variant: "error",
        title: "Logo not saved",
        description: saved.error,
      });
    }
  }

  async function onRemove() {
    setBusy(true);
    const result = await removeBusinessLogo();
    setBusy(false);
    if (result.ok) {
      onLogoChange?.(null);
      toast({ variant: "success", title: "Logo removed" });
      router.refresh();
    } else {
      toast({
        variant: "error",
        title: "Logo not removed",
        description: result.error,
      });
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex h-[104px] items-center justify-center rounded-xl border border-line bg-surface px-4">
        {logoUrl ? (
          // R2 signed URLs are short-lived, so next/image cannot cache them.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={`${businessName} logo`}
            className="max-h-[84px] max-w-full object-contain"
          />
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-content-subtle">
            <Building2 className="size-6" aria-hidden />
            <span className="text-[12px]">No logo yet</span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="sr-only"
          aria-label="Upload a business logo"
          onChange={onFile}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={readOnly}
          onClick={() => fileRef.current?.click()}
        >
          {hasLogo ? "Change logo" : "Upload logo"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={readOnly || busy || !hasLogo}
          className="text-danger-600 hover:bg-danger-50"
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>

      <p className="text-[12px] text-content-muted">
        Square PNG, JPG, WebP or SVG — at least 512 × 512px, up to 10MB.
      </p>
    </div>
  );
}

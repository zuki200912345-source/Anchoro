"use client";

// Sharing, in order of preference: the Web Share API with the card image
// attached as a file (that is what lands in Instagram Stories and Snapchat
// share sheets), then explicit WhatsApp / X / copy-link buttons. TikTok and
// Instagram have no web intent at all, so when there is an image we offer
// save-plus-caption and say so plainly.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export interface ShareButtonProps {
  title: string;
  text: string;
  url: string;
  imageUrl?: string;
  // Current user's friend code; every shared link carries it as ?ref= so
  // sign-ups through the link credit the sharer.
  friendCode?: string;
  className?: string;
}

const chip =
  "inline-flex min-h-11 items-center justify-center rounded-(--radius-ctl) " +
  "border border-ink bg-chalk px-4 py-2 text-sm font-semibold text-ink hover:bg-paper";

export function ShareButton({
  title,
  text,
  url,
  imageUrl,
  friendCode,
  className = "",
}: ShareButtonProps) {
  const shareUrl = friendCode
    ? `${url}${url.includes("?") ? "&" : "?"}ref=${encodeURIComponent(friendCode)}`
    : url;
  const caption = `${text} ${shareUrl}`;

  const [canWebShare, setCanWebShare] = useState(false);
  const [copied, setCopied] = useState<"link" | "caption" | null>(null);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    setCanWebShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    );
  }, []);

  const copy = async (what: "link" | "caption") => {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(what === "link" ? shareUrl : caption);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopyError(true);
    }
  };

  const webShare = async () => {
    try {
      if (imageUrl) {
        try {
          const blob = await (await fetch(imageUrl)).blob();
          const file = new File([blob], "anchor-card.png", {
            type: blob.type || "image/png",
          });
          if (navigator.canShare?.({ files: [file] })) {
            // Some targets drop the url field when files are attached, so the
            // link rides along inside the text.
            await navigator.share({ title, text: caption, files: [file] });
            return;
          }
        } catch {
          // Card fetch failed; share the link on its own below.
        }
      }
      await navigator.share({ title, text, url: shareUrl });
    } catch {
      // Share sheet dismissed. Nothing to clean up.
    }
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {canWebShare ? (
        <div>
          <Button onClick={webShare}>Share</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <a
            className={chip}
            href={`https://wa.me/?text=${encodeURIComponent(caption)}`}
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp
          </a>
          <a
            className={chip}
            href={`https://x.com/intent/tweet?text=${encodeURIComponent(caption)}`}
            target="_blank"
            rel="noreferrer"
          >
            Post on X
          </a>
          <button type="button" className={chip} onClick={() => copy("link")}>
            {copied === "link" ? "Copied" : "Copy link"}
          </button>
        </div>
      )}

      {imageUrl && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-slate">
            TikTok and Instagram don&apos;t take web shares. Save the image,
            paste the caption.
          </p>
          <div className="flex flex-wrap gap-2">
            <a className={chip} href={imageUrl} download="anchor-card.png">
              Save image
            </a>
            <button
              type="button"
              className={chip}
              onClick={() => copy("caption")}
            >
              {copied === "caption" ? "Copied" : "Copy caption"}
            </button>
          </div>
        </div>
      )}

      {copyError && (
        <p className="text-sm text-flag">
          Copying failed. Select the link text and copy it yourself.
        </p>
      )}
    </div>
  );
}

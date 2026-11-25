import React from "react";
import { Ban } from "lucide-react";

interface Props {
  tokenId: string;
  tokenName: string;
}

export default function RevokeTokenButton({ tokenId, tokenName }: Props) {
  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!window.confirm("Revoke this token? The extension can no longer use it. You cannot undo this.")) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action={`/api/tokens/${tokenId}/revoke`} onSubmit={handleSubmit}>
      <button
        type="submit"
        data-testid="token-revoke-button"
        aria-label={`Revoke the token ${tokenName}`}
        className="border-destructive/40 bg-card text-destructive hover:bg-destructive/10 flex min-h-11 w-full min-w-11 items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors"
      >
        <Ban className="size-4" />
        Revoke
      </button>
    </form>
  );
}

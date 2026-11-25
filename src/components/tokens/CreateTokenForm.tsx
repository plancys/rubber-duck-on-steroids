import React, { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import { TOKEN_NAME_MAX_LENGTH, checkTokenName, tokenErrorText } from "@/lib/tokens";

interface Props {
  // True when the learner has the maximum count of live tokens. The form then shows the limit text.
  atLimit: boolean;
}

interface CreatedToken {
  name: string;
  token: string;
}

function isCreatedToken(value: unknown): value is CreatedToken {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.name === "string" && typeof body.token === "string";
}

function errorKeyOf(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const key = (value as Record<string, unknown>).error;
    if (typeof key === "string") return key;
  }
  return "unknown";
}

// The token stays only in the state of this component. A reload of the page drops it, so it shows once.
export default function CreateTokenForm({ atLimit }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(atLimit ? tokenErrorText("token_limit") : null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(form: HTMLFormElement) {
    setPending(true);
    try {
      const response = await fetch("/api/tokens", { method: "POST", body: new FormData(form) });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && isCreatedToken(body)) {
        setCreated({ name: body.name, token: body.token });
        setName("");
      } else {
        setError(tokenErrorText(errorKeyOf(body)));
      }
    } catch {
      setError(tokenErrorText("unknown"));
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const checked = checkTokenName(name);
    if ("error" in checked) {
      setError(tokenErrorText(checked.error));
      return;
    }
    setError(null);
    void create(e.currentTarget);
  }

  function handleCopy(token: string) {
    navigator.clipboard.writeText(token).then(
      () => {
        setCopied(true);
      },
      () => {
        setCopied(false);
      },
    );
  }

  if (created) {
    return (
      <div data-testid="token-created" className="space-y-3">
        <p className="text-sm font-semibold">Copy the token now. You cannot see it again.</p>
        <p className="text-muted-foreground text-xs">
          Token: <span className="text-foreground font-semibold break-all">{created.name}</span>
        </p>
        <code
          data-testid="token-value"
          className="bg-background border-border block rounded-lg border px-3 py-2 font-mono text-sm break-all"
        >
          {created.token}
        </code>
        <button
          type="button"
          onClick={() => {
            handleCopy(created.token);
          }}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex min-h-11 w-full min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-base font-bold transition-colors"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy the token"}
        </button>
        <button
          type="button"
          data-testid="token-done-button"
          onClick={() => {
            window.location.reload();
          }}
          className="border-border bg-card hover:bg-muted flex min-h-11 w-full min-w-11 items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form method="POST" action="/api/tokens" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div>
        <label htmlFor="token_name" className="mb-1 block text-sm font-semibold">
          Token name
        </label>
        <input
          id="token_name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          maxLength={TOKEN_NAME_MAX_LENGTH}
          placeholder="For example: Chrome on my laptop"
          autoComplete="off"
          data-testid="token-name-input"
          className="bg-background border-input text-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 text-base focus:ring-2 focus:outline-none"
        />
      </div>

      <ServerError message={error} />

      <button
        type="submit"
        disabled={pending}
        data-testid="token-create-button"
        className="bg-primary text-primary-foreground hover:bg-primary/90 flex min-h-11 w-full min-w-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-base font-bold transition-colors"
      >
        <KeyRound className="size-4" />
        {pending ? "Creating..." : "Create a token"}
      </button>
    </form>
  );
}

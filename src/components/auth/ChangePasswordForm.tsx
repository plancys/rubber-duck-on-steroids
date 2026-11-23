import React, { useState } from "react";
import { Lock, KeyRound } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

const MIN_PASSWORD_LENGTH = 8;

interface Props {
  serverError?: string | null;
}

export default function ChangePasswordForm({ serverError }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [errors, setErrors] = useState<{ currentPassword?: string; password?: string; passwordConfirm?: string }>({});

  function validate() {
    const next: typeof errors = {};

    if (!currentPassword) {
      next.currentPassword = "Current password is required";
    }

    if (!password) {
      next.password = "New password is required";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    }

    if (!passwordConfirm) {
      next.passwordConfirm = "Confirm the new password";
    } else if (password !== passwordConfirm) {
      next.passwordConfirm = "The new passwords do not match";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  const passwordHint =
    !errors.password && password.length > 0 && password.length < MIN_PASSWORD_LENGTH ? (
      <p className="text-muted-foreground mt-1 text-xs">
        {MIN_PASSWORD_LENGTH - password.length} more character
        {MIN_PASSWORD_LENGTH - password.length !== 1 ? "s" : ""} needed
      </p>
    ) : undefined;

  return (
    <form method="POST" action="/api/auth/change-password" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="current_password"
        label="Current password"
        type={showCurrentPassword ? "text" : "password"}
        value={currentPassword}
        onChange={(v) => {
          setCurrentPassword(v);
          clearError("currentPassword");
        }}
        placeholder="Your current password"
        autoComplete="current-password"
        error={errors.currentPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showCurrentPassword}
            onToggle={() => {
              setShowCurrentPassword(!showCurrentPassword);
            }}
          />
        }
      />

      <FormField
        id="password"
        label="New password"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError("password");
        }}
        placeholder="Min. 8 characters"
        autoComplete="new-password"
        error={errors.password}
        hint={passwordHint}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPassword}
            onToggle={() => {
              setShowPassword(!showPassword);
            }}
          />
        }
      />

      <FormField
        id="password_confirm"
        label="Confirm new password"
        type={showPasswordConfirm ? "text" : "password"}
        value={passwordConfirm}
        onChange={(v) => {
          setPasswordConfirm(v);
          clearError("passwordConfirm");
        }}
        placeholder="Type the new password again"
        autoComplete="new-password"
        error={errors.passwordConfirm}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPasswordConfirm}
            onToggle={() => {
              setShowPasswordConfirm(!showPasswordConfirm);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Saving..." icon={<KeyRound className="size-4" />}>
        Change password
      </SubmitButton>
    </form>
  );
}

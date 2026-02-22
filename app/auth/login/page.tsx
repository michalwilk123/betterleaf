"use client";

import { AuthCardShell } from "@/components/auth/auth-card-shell";
import { GoogleLoginButton } from "@/components/auth/social-login-button";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <AuthCardShell
          title="Log in to BetterLeaf"
          description="Sign in with your Google account to continue."
        >
          <GoogleLoginButton />
        </AuthCardShell>
      </div>
    </div>
  );
}

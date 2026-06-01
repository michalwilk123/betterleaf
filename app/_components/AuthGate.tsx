"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { Loader2 } from "lucide-react";

function FullScreenSpinner() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

/**
 * Gates protected pages on the *Convex* auth token (the signal that actually
 * decides whether Convex queries run authenticated). Renders children only once
 * authenticated; otherwise shows a spinner and redirects unauthenticated users
 * to the login page. Reading `useConvexAuth` instead of the Better Auth session
 * avoids the transient "logged-out" window during the cross-domain OAuth flow.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/auth/login");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated) {
    return <FullScreenSpinner />;
  }

  return <>{children}</>;
}

/**
 * For auth pages (login / enter): sends already-authenticated users to the app
 * instead of leaving them stuck on the login screen once their session lands.
 */
export function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/projects");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || isAuthenticated) {
    return <FullScreenSpinner />;
  }

  return <>{children}</>;
}

import Link from "next/link";
import { CheckCircle2, Github } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function GithubConnectedPage({
  searchParams,
}: {
  searchParams: Promise<{ login?: string }>;
}) {
  const { login } = await searchParams;
  const displayLogin = login?.trim() || "your GitHub account";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border border-border/60 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <div className="mb-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Github className="h-4 w-4" />
          GitHub connected
        </div>
        <h1 className="text-xl font-semibold text-foreground">
          Connected with {displayLogin}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You can close this tab and return to BetterLeaf.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/projects">Back to projects</Link>
        </Button>
      </div>
    </main>
  );
}

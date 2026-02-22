"use client";

import React, { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import {
  Leaf,
  Search,
  Plus,
  FolderOpen,
  Users,
  LayoutGrid,
  MoreHorizontal,
  Copy,
  Download,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  LogOut,
  Settings,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateProjectModal } from "./_components/CreateProjectModal";
import { SettingsModal } from "./_components/SettingsModal";

type Filter = "all" | "owned" | "shared";
type SortField = "title" | "owner" | "lastModified";
type SortDir = "asc" | "desc";

function formatRelativeDate(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground/50" />;
  return sortDir === "asc"
    ? <ArrowUp className="ml-1 h-3.5 w-3.5 text-primary" />
    : <ArrowDown className="ml-1 h-3.5 w-3.5 text-primary" />;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("lastModified");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/auth/login");
    }
  }, [isPending, session, router]);

  const projects = useQuery(api.projects.list);
  const removeProject = useMutation(api.projects.remove);
  const resolvePendingInvites = useMutation(api.members.resolvePendingInvites);

  const resolvedRef = React.useRef(false);
  useEffect(() => {
    if (session && !resolvedRef.current) {
      resolvedRef.current = true;
      resolvePendingInvites().catch(() => {});
    }
  }, [session, resolvePendingInvites]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "title" ? "asc" : "desc");
    }
  };

  const filtered = useMemo(() => {
    if (!projects) return [];
    let list = [...projects];
    if (filter === "owned") list = list.filter((p) => p.isOwned);
    if (filter === "shared") list = list.filter((p) => !p.isOwned);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "title") cmp = a.name.localeCompare(b.name);
      else if (sortField === "owner") cmp = 0; // owner sort not meaningful without owner names
      else cmp = a.updatedAt - b.updatedAt;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [projects, filter, search, sortField, sortDir]);

  const counts = useMemo(() => {
    if (!projects) return { all: 0, owned: 0, shared: 0 };
    return {
      all: projects.length,
      owned: projects.filter((p) => p.isOwned).length,
      shared: projects.filter((p) => !p.isOwned).length,
    };
  }, [projects]);

  const handleDelete = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this project?")) return;
    await removeProject({ projectId: projectId as any });
  };

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/auth/login");
  };

  const filterItems: { key: Filter; label: string; icon: React.ReactNode; count: number }[] = [
    { key: "all", label: "All Projects", icon: <LayoutGrid className="h-4 w-4" />, count: counts.all },
    { key: "owned", label: "My Projects", icon: <FolderOpen className="h-4 w-4" />, count: counts.owned },
    { key: "shared", label: "Shared with Me", icon: <Users className="h-4 w-4" />, count: counts.shared },
  ];

  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";
  const initials = getInitials(userName);

  if (isPending || !session) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (projects === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-white px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Leaf className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            BetterLeaf
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-full p-1 pr-2 transition-colors hover:bg-accent">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{userName}</p>
              <p className="text-xs text-muted-foreground">{userEmail}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings className="mr-2 h-4 w-4" /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-border/60 bg-muted/30 p-4">
          <Button
            className="mb-6 w-full gap-2 bg-primary font-medium shadow-sm hover:bg-primary/90"
            onClick={() => setCreateModalOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>

          <nav className="flex flex-col gap-1">
            {filterItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setFilter(item.key)}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  filter === item.key
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {item.icon}
                <span className="flex-1 text-left">{item.label}</span>
                <Badge
                  variant="secondary"
                  className={`ml-auto h-5 min-w-[20px] justify-center px-1.5 text-[11px] font-semibold ${
                    filter === item.key
                      ? "bg-primary/15 text-primary"
                      : "bg-border/60 text-muted-foreground"
                  }`}
                >
                  {item.count}
                </Badge>
              </button>
            ))}
          </nav>

          <Separator className="my-4" />

          <div className="mt-auto text-xs text-muted-foreground/60">
            BetterLeaf v0.1
          </div>
        </aside>

        {/* Main */}
        <main className="flex flex-1 flex-col overflow-hidden p-6">
          {/* Search bar */}
          <div className="mb-5 flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search projects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-white border-border/60"
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {filtered.length} project{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto rounded-lg border border-border/60 bg-white">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("title")}
                  >
                    <span className="inline-flex items-center">
                      Title <SortIcon field="title" sortField={sortField} sortDir={sortDir} />
                    </span>
                  </TableHead>
                  <TableHead
                    className="w-[160px] cursor-pointer select-none"
                    onClick={() => toggleSort("lastModified")}
                  >
                    <span className="inline-flex items-center">
                      Last Modified <SortIcon field="lastModified" sortField={sortField} sortDir={sortDir} />
                    </span>
                  </TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-40 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Search className="h-8 w-8 opacity-30" />
                        <p className="text-sm">No projects found</p>
                        <p className="text-xs">Try a different search term or filter</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((project) => (
                    <TableRow
                      key={project._id}
                      className="group cursor-pointer transition-colors hover:bg-accent/50"
                      onClick={() => router.push(`/projects/${project.shortId}`)}
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/projects/${project.shortId}`}
                          className="flex items-center gap-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary">
                            <Leaf className="h-4 w-4" />
                          </div>
                          <div className="flex items-center gap-2 truncate">
                            <span className="truncate">{project.name}</span>
                            {!project.isOwned && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                Shared
                              </Badge>
                            )}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatRelativeDate(project.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                              <Copy className="mr-2 h-4 w-4" /> Copy
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                              <Download className="mr-2 h-4 w-4" /> Download ZIP
                            </DropdownMenuItem>
                            {project.isOwned && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={(e) => handleDelete(project._id, e)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </main>
      </div>

      <CreateProjectModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

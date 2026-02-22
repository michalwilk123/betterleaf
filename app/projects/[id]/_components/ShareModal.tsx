"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Trash2, UserPlus, Loader2, Globe } from "lucide-react";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  projectId: Id<"projects">;
  currentPublicAccess?: "none" | "read" | "edit";
}

export function ShareModal({ open, onClose, projectId, currentPublicAccess }: ShareModalProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [inviting, setInviting] = useState(false);

  const members = useQuery(api.members.list, open ? { projectId } : "skip");
  const pendingInvites = useQuery(
    api.members.listPendingInvites,
    open ? { projectId } : "skip"
  );
  const addByEmail = useMutation(api.members.addByEmail);
  const removeMember = useMutation(api.members.remove);
  const removeInvite = useMutation(api.members.removeInvite);
  const updateProject = useMutation(api.projects.update);

  const publicAccess = currentPublicAccess ?? "none";
  const isPublic = publicAccess === "read" || publicAccess === "edit";

  const handlePublicToggle = (checked: boolean) => {
    updateProject({
      projectId,
      publicAccess: checked ? "read" : "none",
    });
  };

  const handlePublicRoleChange = (value: string) => {
    updateProject({
      projectId,
      publicAccess: value as "read" | "edit",
    });
  };

  const handleInvite = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviting(true);
    try {
      await addByEmail({ projectId, email: trimmed, role });
      setEmail("");
    } finally {
      setInviting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && email.trim()) handleInvite();
  };

  return (
    <Modal open={open} onClose={onClose} title="Share Project" className="max-w-lg">
      <div className="flex flex-col gap-4">
        {/* Public access section */}
        <div className="rounded-md border border-border/60 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Public access</p>
                <p className="text-xs text-muted-foreground">
                  Anyone with the link can access this project
                </p>
              </div>
            </div>
            <Switch checked={isPublic} onCheckedChange={handlePublicToggle} />
          </div>
          {isPublic && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Permission:</span>
              <select
                value={publicAccess}
                onChange={(e) => handlePublicRoleChange(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="read">Can view</option>
                <option value="edit">Can edit</option>
              </select>
            </div>
          )}
        </div>

        {/* Members list */}
        <div className="max-h-60 overflow-y-auto">
          {members && members.length > 0 && (
            <div className="flex flex-col gap-2">
              {members.map((member) => (
                <div
                  key={member._id}
                  className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{member.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    Accepted
                  </Badge>
                  <span className="text-xs text-muted-foreground capitalize shrink-0">
                    {member.role === "editor" ? "Editor" : "Reader"}
                  </span>
                  <button
                    onClick={() => removeMember({ memberId: member._id })}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {pendingInvites && pendingInvites.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              {pendingInvites.map((invite) => (
                <div
                  key={invite._id}
                  className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{invite.email}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-amber-600 border-amber-300">
                    Invited
                  </Badge>
                  <span className="text-xs text-muted-foreground capitalize shrink-0">
                    {invite.role === "editor" ? "Editor" : "Reader"}
                  </span>
                  <button
                    onClick={() => removeInvite({ inviteId: invite._id })}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {(!members || members.length === 0) &&
            (!pendingInvites || pendingInvites.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No collaborators yet. Invite someone below.
              </p>
            )}
        </div>

        {/* Invite section */}
        <div className="border-t border-border/60 pt-4">
          <div className="flex gap-2">
            <Input
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={inviting}
              className="flex-1"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={inviting}
            >
              <option value="editor">Editor</option>
              <option value="viewer">Reader</option>
            </select>
          </div>
          <Button
            onClick={handleInvite}
            disabled={inviting || !email.trim()}
            className="w-full mt-3 gap-2"
          >
            {inviting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            {inviting ? "Inviting..." : "Invite"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

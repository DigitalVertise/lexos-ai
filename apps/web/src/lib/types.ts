export type Role = "owner" | "admin" | "lawyer" | "staff";
export type PlanId = "trial" | "basic" | "pro" | "none";

export interface Organization {
  id: string;
  name: string;
  country: string | null;
  default_jurisdiction: string | null;
  plan: PlanId;
  subscription_status: string;
  trial_ends_at: string;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  created_at: string;
  website_url: string | null;
  logo_url: string | null;
  brand_colors: string[];
  brand_primary: string | null;
  brand_accent: string | null;
  theme: "light" | "dark" | "auto";
  portal_slug: string | null;
  portal_enabled: boolean;
  portal_welcome: string | null;
}

export interface Membership {
  org_id: string;
  user_id: string;
  role: Role;
  full_name: string | null;
  email: string | null;
  created_at: string;
}

export interface Client {
  id: string;
  org_id: string;
  kind: "individual" | "organization";
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  crm_id: string | null;
  crm_sync_status: "not_synced" | "pending" | "synced" | "failed";
  crm_synced_at: string | null;
  crm_error: string | null;
  created_at: string;
  updated_at: string;
}

export type MatterStatus = "intake" | "open" | "on_hold" | "closed";

export interface Matter {
  id: string;
  org_id: string;
  number: number;
  client_id: string;
  title: string;
  matter_type: string | null;
  jurisdiction: string | null;
  status: MatterStatus;
  responsible_user_id: string | null;
  description: string | null;
  opened_on: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  org_id: string;
  matter_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: "low" | "normal" | "high";
  status: "open" | "done";
  assignee_id: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  org_id: string;
  matter_id: string;
  title: string;
  source: "upload" | "link";
  storage_path: string | null;
  url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: "draft" | "final" | "archived";
  created_at: string;
  shared_with_client?: boolean;
}

export interface AgentHire {
  id: string;
  org_id: string;
  agent_key: string;
  name: string;
  instructions: string | null;
  status: "active" | "paused";
  hired_at: string;
  avatar: AvatarConfig | null;
}

/** Saved on agent_hires.avatar. Portrait files live in the private documents bucket. */
export interface AvatarConfig {
  provider: string;               // see lib/avatars/providers.ts
  portrait_path?: string | null;  // {org}/avatars/{hire}/portrait.ext
  portrait_source?: "upload" | "generated" | "provider" | null;
  anchor?: { x: number; y: number } | null; // lip anchor, 0..1 of image size
  voice?: string | null;          // edge-tts voice id or provider voice id
  provider_avatar_id?: string | null;
  provider_avatar_kind?: string | null; // e.g. HeyGen "avatar" | "talking_photo"
  provider_voice_id?: string | null;
  provider_preview_url?: string | null;
  consent?: { confirmed: boolean; by: string; at: string } | null;
}

export interface AiOutput {
  id: string;
  org_id: string;
  matter_id: string | null;
  agent_hire_id: string | null;
  agent_key: string | null;
  workflow: string;
  instructions: string | null;
  output: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  created_by: string | null;
  created_at: string;
}

export const matterRef = (m: Pick<Matter, "number">) => `M-${m.number}`;

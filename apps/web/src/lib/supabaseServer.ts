// Server-only Supabase client for the events/feedback store. Never import
// this from a "use client" component -- SUPABASE_SERVICE_ROLE_KEY bypasses
// row-level security and must not reach the browser.

import "server-only";
import { createClient } from "@supabase/supabase-js";

// Hand-written to match supabase/schema.sql, in the same shape the
// Supabase CLI's own `gen types` would produce — there's no generated-types
// step in this project yet (that needs the CLI logged into the live
// project), so this is the source of truth for the shape until then.
interface Database {
  public: {
    Tables: {
      events: {
        Row: {
          id: number;
          event_name: string;
          session_id: string;
          payload: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          event_name: string;
          session_id: string;
          payload?: Record<string, unknown>;
        };
        Update: {
          event_name?: string;
          session_id?: string;
          payload?: Record<string, unknown>;
        };
        Relationships: [];
      };
      reminder_optins: {
        Row: {
          id: number;
          email: string;
          bucket_signature: string;
          program_level: string;
          arrival_date: string;
          content_version: number;
          created_at: string;
        };
        Insert: {
          email: string;
          bucket_signature: string;
          program_level: string;
          arrival_date: string;
          content_version: number;
        };
        Update: {
          email?: string;
          bucket_signature?: string;
          program_level?: string;
          arrival_date?: string;
          content_version?: number;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
  };
}

let client: ReturnType<typeof createClient<Database>> | null = null;

export function supabaseServer() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set — copy apps/web/.env.example to .env.local and fill them in."
    );
  }

  client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return client;
}

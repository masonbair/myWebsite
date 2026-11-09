import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestDeps } from "./ingest";
import type { NewsSource } from "./types";

type SourceRow = {
  id: string;
  name: string;
  sender_addresses: string[];
  sender_domains: string[];
  homepage: string | null;
  archive_pattern: string | null;
  public: boolean;
  active: boolean;
};

/** Supabase-backed ingest dependencies, shared by the inbound webhook and the backfill script. */
export function createIngestDeps(
  client: SupabaseClient,
  putRaw: (path: string, raw: Uint8Array) => Promise<void>,
  timeZone: string,
): IngestDeps {
  async function findIssueId(messageId: string): Promise<string | null> {
    const { data, error } = await client.from("news_issues").select("id").eq("message_id", messageId).maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  }

  return {
    async sources(): Promise<NewsSource[]> {
      const { data, error } = await client.from("news_sources").select("*").eq("active", true);
      if (error) throw error;
      return (data as SourceRow[]).map((r) => ({
        id: r.id,
        name: r.name,
        senderAddresses: r.sender_addresses,
        senderDomains: r.sender_domains,
        homepage: r.homepage,
        archivePattern: r.archive_pattern,
        public: r.public,
        active: r.active,
      }));
    },
    putRaw,
    async insertIssue(row) {
      const { data, error } = await client
        .from("news_issues")
        .insert({
          source_id: row.sourceId,
          message_id: row.messageId,
          subject: row.subject,
          from_address: row.fromAddress,
          received_at: row.receivedAt,
          published_on: row.publishedOn,
          raw_path: row.rawPath,
          clean_text: row.cleanText,
          public_url: row.publicUrl,
          status: row.status,
        })
        .select("id")
        .single();
      if (error?.code === "23505") return null;
      if (error) throw error;
      return { id: data.id };
    },
    findIssueId,
    timeZone,
  };
}

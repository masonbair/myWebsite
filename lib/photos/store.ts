import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthSpend, recordUsage } from "@/lib/ai/claude";
import { BUCKET } from "@/shared/collector-contract";
import { MAX_LABEL_ATTEMPTS, type PhotoLabelStore } from "./job";

export function supabasePhotoLabelStore(client: SupabaseClient): PhotoLabelStore {
  return {
    async unlabeled(limit) {
      const { data, error } = await client
        .from("collector_photo")
        .select("asset_id, path")
        .is("labeled_at", null)
        .eq("hidden", false)
        .lt("label_attempts", MAX_LABEL_ATTEMPTS)
        .order("taken_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r) => ({ assetId: r.asset_id as string, path: r.path as string }));
    },
    async download(path) {
      const { data, error } = await client.storage.from(BUCKET.photos).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async saveLabel(assetId, label, at) {
      const { error } = await client
        .from("collector_photo")
        .update({
          description: label.description,
          kind: label.kind,
          places: label.places,
          score: label.score,
          labeled_at: at.toISOString(),
          label_error: null,
        })
        .eq("asset_id", assetId);
      if (error) throw error;
    },
    async recordFailure(assetId, reason) {
      const { data, error } = await client.from("collector_photo").select("label_attempts").eq("asset_id", assetId).single();
      if (error) throw error;
      const { error: updateError } = await client
        .from("collector_photo")
        .update({ label_attempts: (data.label_attempts as number) + 1, label_error: reason.slice(0, 100) })
        .eq("asset_id", assetId);
      if (updateError) throw updateError;
    },
    async recordUsage({ model, itemId, usage }) {
      await recordUsage(client, { feature: "photos", model, itemId: null, purpose: `label ${itemId}`, usage });
    },
    async spend(now) {
      return (await monthSpend(client, "photos", now)).thisMonth;
    },
  };
}

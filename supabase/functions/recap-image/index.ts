// OPTIONAL STUB. POST /functions/v1/recap-image  { group_id }
// Generates a shareable recap image of the locked plan with Grok Imagine and stores the URL on
// groups.recap_image_url. Uses xAI's images endpoint (https://api.x.ai/v1/images/generations).
// Secrets: GROK_API_KEY (or XAI_API_KEY). Optional GROK_IMAGE_MODEL (default below).
// Note: returned image URLs may be temporary. Copy the image to Supabase Storage if you need it to persist.

import { adminClient } from "../_shared/db.ts";
import { HttpError, reqString, serveJson } from "../_shared/http.ts";

const DEFAULT_IMAGE_MODEL = "grok-imagine-image-2.0";

Deno.serve(serveJson(async (body) => {
  const groupId = reqString(body, "group_id");
  const apiKey = Deno.env.get("GROK_API_KEY") ?? Deno.env.get("XAI_API_KEY");
  if (!apiKey) throw new HttpError(500, "GROK_API_KEY (or XAI_API_KEY) secret is not set");

  const db = adminClient();
  const { data: group, error } = await db.from("groups").select("id,name,selected_plan_id").eq("id", groupId).maybeSingle();
  if (error) throw error;
  if (!group?.selected_plan_id) throw new HttpError(400, "Lock a plan first");
  const { data: plan, error: pErr } = await db.from("plans").select("title,items").eq("id", group.selected_plan_id).single();
  if (pErr) throw pErr;
  const { count } = await db.from("members").select("id", { count: "exact", head: true }).eq("group_id", groupId);

  const stops = (plan.items as { name: string }[]).map((i) => i.name).join(", then ");
  const prompt =
    `A warm, playful illustrated postcard celebrating a friend group's day out in Atlanta called "${plan.title}". ` +
    `Scenes: ${stops}. ${count ?? "A few"} diverse friends, no readable faces of real people, no logos, ` +
    `Atlanta skyline in the background, bright sunset colors, caption area left blank.`;

  const res = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: Deno.env.get("GROK_IMAGE_MODEL") || DEFAULT_IMAGE_MODEL, prompt }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new HttpError(502, `xAI image error ${res.status}`, (await res.text()).slice(0, 2000));
  const data = await res.json();
  const url: string | undefined = data?.data?.[0]?.url;
  if (!url) throw new HttpError(502, "No image URL in response", data);

  const upd = await db.from("groups").update({ recap_image_url: url }).eq("id", groupId);
  if (upd.error) throw upd.error;
  return { url, prompt };
}));

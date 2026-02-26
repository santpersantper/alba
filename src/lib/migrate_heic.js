import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "../lib/supabase";

const BUCKET = "alba-media";

const isHeicUrl = (u="") => /\.heic($|\?)/i.test(u);

export async function migrateHeicForPost(postRow) {
  const id = postRow.id;
  const media = postRow.postmediauri || [];
  if (!id || !Array.isArray(media) || media.length === 0) return { updated: false };

  const newMedia = [];
  let changed = false;

  for (let i = 0; i < media.length; i++) {
    const url = media[i];
    if (!isHeicUrl(url)) { newMedia.push(url); continue; }

    try {
      // 1) download to a local file
      const tmpPath = `${FileSystem.cacheDirectory}heic_${id}_${i}.heic`;
      const dl = await FileSystem.downloadAsync(url, tmpPath);

      // 2) convert to JPEG
      const jpeg = await ImageManipulator.manipulateAsync(
        dl.uri,
        [],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );

      // 3) upload to Supabase
      const key = `posts/${id}/media_${i}.jpg`;
      const bytes = await (await fetch(jpeg.uri)).arrayBuffer();

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(key, new Uint8Array(bytes), {
          contentType: "image/jpeg",
          cacheControl: "31536000",
          upsert: true,
        });
      if (upErr) throw upErr;

      // 4) prefer signed URL if bucket is private
      const expiresIn = 60 * 60 * 24 * 180; // 180 days
      const { data: signed, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(key, expiresIn);

      newMedia.push(!signErr && signed?.signedUrl
        ? signed.signedUrl
        : supabase.storage.from(BUCKET).getPublicUrl(key).data.publicUrl
      );

      changed = true;
    } catch (e) {
      console.warn("HEIC migrate failed for", id, e);
      // keep the original URL so you don't lose media
      newMedia.push(url);
    }
  }

  if (changed) {
    const { error: updErr } = await supabase
      .from("posts")
      .update({ postmediauri: newMedia })
      .eq("id", id);
    if (updErr) throw updErr;
  }
  return { updated: changed, postId: id };
}

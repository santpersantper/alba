import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base-64";
import { supabase } from "./supabase";

// uri: e.g. from ImagePicker or FileSystem (expo): "file:///..."
export async function uploadImage({ uri, postId, filename }) {
  // 1) Turn local file into a Blob
  const res = await fetch(uri);
  const blob = await res.blob();

  // 2) Build object key
  const key = `posts/${postId}/media/${filename}`;

  // 3) Upload
  const { data, error } = await supabase.storage
    .from("alba-media")
    .upload(key, blob, {
      upsert: true,
      contentType: blob.type || "image/jpeg",
      cacheControl: "31536000", // 1 year (tune as you like)
    });
  if (error) throw error;

  // 4) Get a URL
  // Public bucket:
  const { data: pub } = supabase.storage.from("alba-media").getPublicUrl(key);
  return pub.publicUrl;

  // Private bucket (alternative):
  // const { data: signed } = await supabase.storage.from("alba-media")
  //   .createSignedUrl(key, 60 * 60); // 1h
  // return signed.signedUrl;
}

// Upload a chat image and return its public URL.
// Stored at chats/{chatId}/{timestamp}.{ext} inside the "alba-media" bucket.
export async function uploadChatImage({ uri, chatId }) {
  const ext = uri.split(".").pop()?.split("?")[0]?.toLowerCase() || "jpg";
  const mimeType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
  const key = `chats/${chatId}/${Date.now()}.${ext}`;

  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  const binary = decode(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);

  const { error } = await supabase.storage
    .from("alba-media")
    .upload(key, buffer, { upsert: false, contentType: mimeType });
  if (error) throw error;
  const { data: pub } = supabase.storage.from("alba-media").getPublicUrl(key);
  return pub.publicUrl;
}

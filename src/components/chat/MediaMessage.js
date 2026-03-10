// components/chat/MediaMessage.js
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import ShareMenu from "../ShareMenu";

const VIDEO_EXTS = ["mp4", "mov", "m4v", "webm", "avi"];

function isVideoUrl(uri) {
  if (!uri) return false;
  const ext = uri.split("?")[0].split(".").pop()?.toLowerCase();
  return VIDEO_EXTS.includes(ext);
}

// Muted video paused at frame 0 — shows first frame as thumbnail
function VideoFirstFrame({ videoUrl, style }) {
  const player = useVideoPlayer(videoUrl, (p) => {
    p.muted = true;
  });
  return (
    <VideoView
      player={player}
      style={style}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

// Full-screen video player with tap to play/pause
function FullscreenVideo({ videoUrl }) {
  const [playing, setPlaying] = useState(true);
  const player = useVideoPlayer(videoUrl, (p) => {
    p.loop = false;
    p.play();
  });

  const togglePlay = () => {
    if (playing) {
      player.pause();
    } else {
      player.play();
    }
    setPlaying((v) => !v);
  };

  return (
    <TouchableOpacity
      style={StyleSheet.absoluteFill}
      activeOpacity={1}
      onPress={togglePlay}
    >
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />
      {!playing && (
        <View style={styles.fsPlayOverlay}>
          <View style={styles.fsPlayCircle}>
            <Feather name="play" size={36} color="#fff" style={{ paddingLeft: 4 }} />
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// Full-screen viewer Modal
function FullscreenViewer({ uri, onClose }) {
  const isVideo = isVideoUrl(uri);
  const insets = useSafeAreaInsets();

  const handleDownload = useCallback(async () => {
    try {
      await Linking.openURL(uri);
    } catch (e) {
      Alert.alert("Error", "Could not open the file.");
    }
  }, [uri]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.fsRoot}>
        {/* Media */}
        {isVideo ? (
          <FullscreenVideo videoUrl={uri} />
        ) : (
          <ExpoImage
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
        )}

        {/* Top buttons — always below OS status bar */}
        <View style={[styles.fsTopBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} style={styles.fsBtn} hitSlop={12} activeOpacity={0.8}>
            <Feather name="x" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDownload} style={styles.fsBtn} hitSlop={12} activeOpacity={0.8}>
            <Feather name="download" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function MediaMessage({
  id,
  uris = [],
  caption,
  time,
  isMe = false,
  onDeleted,
}) {
  const [viewerUri, setViewerUri] = useState(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportText, setReportText] = useState("");
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);

  const openReport = () => {
    setMenuVisible(false);
    setReportVisible(true);
  };

  const submitReport = () => {
    setReportText("");
    setReportVisible(false);
    Alert.alert("", "Thanks for your report.");
  };

  const openDeleteConfirm = () => {
    setMenuVisible(false);
    setConfirmVisible(true);
  };

  const runDelete = async () => {
    if (!id) { setConfirmVisible(false); return; }
    try {
      setDeleting(true);
      const { error } = await supabase.from("messages").delete().eq("id", id);
      if (error) throw error;
      setConfirmVisible(false);
      onDeleted?.(id);
    } catch (e) {
      console.warn("Media delete failed", e?.message || e);
      Alert.alert("Error", "Could not delete this message.");
    } finally {
      setDeleting(false);
    }
  };

  const openForward = () => {
    setMenuVisible(false);
    setShareVisible(true);
  };

  return (
    <>
      <View style={styles.row}>
        <View style={[styles.line1, { justifyContent: isMe ? "flex-end" : "flex-start" }]}>
          <View style={{ maxWidth: "82%" }}>
            <View style={styles.mediaGrid}>
              {uris.slice(0, 3).map((u, i) => {
                const isVid = isVideoUrl(u);
                const imgStyle = uris.length === 1 ? styles.mediaOne : styles.mediaMany;
                return (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.9}
                    onPress={() => setViewerUri(u)}
                    onLongPress={() => setMenuVisible(true)}
                    delayLongPress={400}
                  >
                    <View style={[imgStyle, { overflow: "hidden" }]}>
                      {isVid ? (
                        <>
                          <VideoFirstFrame videoUrl={u} style={StyleSheet.absoluteFill} />
                          <View style={styles.vidOverlay} />
                          <View style={styles.playWrap}>
                            <View style={styles.playCircle}>
                              <Feather name="play" size={20} color="#fff" style={{ paddingLeft: 2 }} />
                            </View>
                          </View>
                        </>
                      ) : (
                        <ExpoImage
                          source={{ uri: u }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                        />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {caption ? (
              <TouchableOpacity
                activeOpacity={1}
                onLongPress={() => setMenuVisible(true)}
                delayLongPress={400}
              >
                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                  <Text style={[styles.msgText, isMe ? { color: "#fff" } : { color: "#1A1F27" }]}>
                    {caption}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={[styles.line2, { alignItems: isMe ? "flex-end" : "flex-start" }]}>
          <Text style={styles.time}>{time}</Text>
        </View>
      </View>

      {/* Full-screen viewer */}
      {viewerUri && (
        <FullscreenViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
      )}

      {/* bottom sheet menu */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        />
        <View style={styles.menuCard}>
          <TouchableOpacity style={styles.menuItem} onPress={openReport}>
            <Text style={styles.menuText}>Report</Text>
          </TouchableOpacity>
          {isMe && (
            <TouchableOpacity style={styles.menuItem} onPress={openForward}>
              <Text style={styles.menuText}>Forward</Text>
            </TouchableOpacity>
          )}
          {isMe && (
            <TouchableOpacity style={styles.menuItem} onPress={openDeleteConfirm}>
              <Text style={[styles.menuText, { color: "#d23b3b" }]}>Delete</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.menuItem, { marginTop: 4 }]}
            onPress={() => setMenuVisible(false)}
          >
            <Text style={[styles.menuText, { color: "#6B7280" }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* report modal */}
      <Modal
        visible={reportVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReportVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.reportCard}>
            <Text style={styles.reportTitle}>Report message</Text>
            <TextInput
              style={styles.reportInput}
              placeholder="Tell us briefly what is wrong"
              placeholderTextColor="#9CA3AF"
              value={reportText}
              onChangeText={setReportText}
              multiline
            />
            <View style={styles.reportRow}>
              <TouchableOpacity
                style={[styles.reportBtn, { backgroundColor: "#b0b6c0" }]}
                onPress={() => setReportVisible(false)}
              >
                <Text style={styles.reportBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportBtn, { backgroundColor: "#3D8BFF", opacity: reportText.trim() ? 1 : 0.6 }]}
                onPress={submitReport}
                disabled={!reportText.trim()}
              >
                <Text style={styles.reportBtnText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* delete confirm */}
      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Are you sure you want to delete this message?</Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#3D8BFF", opacity: deleting ? 0.6 : 1 }]}
                disabled={deleting}
                onPress={runDelete}
              >
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmBtnText}>Yes</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#b0b6c0" }]}
                onPress={() => setConfirmVisible(false)}
              >
                <Text style={styles.confirmBtnText}>No</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* forward */}
      <ShareMenu
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        onSent={() => setShareVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    width: "100%",
    flexDirection: "column",
    marginBottom: 10,
  },
  mediaGrid: { flexDirection: "row", gap: 8, marginBottom: 6 },
  mediaOne: {
    width: 220,
    height: 160,
    borderRadius: 12,
    backgroundColor: "#0a0a0a",
  },
  mediaMany: {
    width: 106,
    height: 106,
    borderRadius: 12,
    backgroundColor: "#0a0a0a",
  },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  bubbleMe: { backgroundColor: "#74AEE7", borderTopRightRadius: 4 },
  bubbleOther: { backgroundColor: "#EAEFF4", borderTopLeftRadius: 4 },
  msgText: { fontSize: 14, lineHeight: 20, fontFamily: "Poppins" },
  line1: { width: "100%", flexDirection: "row", alignItems: "flex-end" },
  line2: { width: "100%", marginTop: 3 },
  time: { fontSize: 11, color: "#A2AAB4", paddingTop: 5, paddingLeft: 2, paddingRight: 2, fontFamily: "Poppins" },

  // video thumbnail overlay
  vidOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.2)" },
  playWrap: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center" },
  playCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },

  // fullscreen viewer
  fsRoot: { flex: 1, backgroundColor: "#000" },
  fsTopBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    zIndex: 20,
  },
  fsBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    margin: 6,
  },
  fsPlayOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center" },
  fsPlayCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },

  // menus / modals
  menuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  menuCard: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 8,
    paddingBottom: 20,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
  },
  menuItem: { paddingVertical: 10 },
  menuText: { fontFamily: "Poppins", fontSize: 15 },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  reportCard: { width: "100%", borderRadius: 14, padding: 16, backgroundColor: "#FFFFFF" },
  reportTitle: { fontFamily: "Poppins", fontSize: 16, marginBottom: 10, textAlign: "center" },
  reportInput: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    minHeight: 80,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: "Poppins",
    fontSize: 14,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  reportRow: { flexDirection: "row", gap: 10 },
  reportBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  reportBtnText: { color: "#fff", fontFamily: "Poppins", fontSize: 15, fontWeight: "600" },

  confirmCard: { width: "100%", borderRadius: 14, padding: 16, backgroundColor: "#FFFFFF" },
  confirmTitle: { fontFamily: "Poppins", fontSize: 16, textAlign: "center", marginBottom: 14 },
  confirmRow: { flexDirection: "row", gap: 10 },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  confirmBtnText: { color: "#fff", fontFamily: "Poppins", fontSize: 15, fontWeight: "600" },
});

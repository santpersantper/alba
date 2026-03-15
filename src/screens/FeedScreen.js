// screens/FeedScreen.js — DROP-IN (cache-first plays, then fetch from 2nd)
import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  FlatList,
  TouchableOpacity,
  Modal,
  Pressable,
  Image,
  TextInput,
  Animated,
  AppState,
} from "react-native";
import {
  useNavigation,
  useFocusEffect,
  useIsFocused,
} from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import {
  FEED_TIMER_ENABLED_KEY,
  FEED_TIMER_ALERT_MINUTES_KEY,
  DEFAULT_ALERT_MINUTES,
} from "./FeedSettingsScreen";
import { VideoView, useVideoPlayer } from "expo-video";
import { Feather, Ionicons } from "@expo/vector-icons";
import ShareMenu from "../components/ShareMenu";
import OnboardingOverlay from "../components/OnboardingOverlay";
import { useFonts } from "expo-font";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { useAlbaLanguage } from "../theme/LanguageContext";

import {
  readCachedFirstFeedVideoOverride,
  cacheFirstFeedVideoFromList,
} from "../lib/feedFirstVideoCache";
import {
  getCachedVideoUrl,
  cacheVideosInBackground,
} from "../lib/feedVideoCache";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const PUBLIC_BUCKET = "public";

/* ---------- helpers ---------- */

function resolveVideoUrl(storagePath) {
  if (!storagePath) return null;

  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
    return storagePath;
  }

  const cleanedPath = storagePath.startsWith("public/")
    ? storagePath.replace(/^public\//, "")
    : storagePath;

  const { data } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(cleanedPath);
  return data?.publicUrl ?? null;
}

function FeedItem({
  item,
  isActive,
  isPreloading,
  isSaved,
  isScreenFocused,
  itemHeight,
  barVisible,
  pausedByHold,
  overlayHiddenByHold,
  safeBottom,
  onShare,
  onToggleSave,
  onTap,
  onLongPress,
  onPressOut,
  onBlockUser,
  onReportUser,
  onAvatarPress,
  onDelete,
}) {
  const { t } = useAlbaLanguage();
  // Only create a loaded player for the active item and the one immediately after
  // (so swiping forward is instant). All other items get null — no buffering.
  const player = useVideoPlayer(
    isActive || isPreloading ? item.videoUrl : null,
    (playerInstance) => {
      playerInstance.loop = true;
      playerInstance.bufferOptions = {
        preferredForwardBufferDuration: 10,
        minBufferForPlayback: 2,
        maxBufferBytes: 15 * 1024 * 1024, // 15 MB cap
      };
    }
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showFullCaption, setShowFullCaption] = useState(false);
  const [isLongCaption, setIsLongCaption] = useState(false);
  const [hasMeasuredCaption, setHasMeasuredCaption] = useState(false);

  React.useEffect(() => {
    if (!player) return;

    try {
      if (isScreenFocused && isActive && !pausedByHold) {
        player.play();
      } else {
        player.pause();
      }
    } catch (e) {
      console.warn("Video play/pause failed for", item.id, e);
    }
  }, [player, isScreenFocused, isActive, pausedByHold, item.id, item.videoUrl]);

  const stop = (e) => e.stopPropagation();

  const pressableHandlers = isActive
    ? {
        onPress: onTap,
        onLongPress,
        onPressOut,
        delayLongPress: 400,
      }
    : {};

  let captionContent = null;

  if (!hasMeasuredCaption) {
    captionContent = (
      <Text
        style={styles.captionText}
        onTextLayout={(e) => {
          if (!hasMeasuredCaption) {
            setHasMeasuredCaption(true);
            if (e.nativeEvent.lines.length > 1) {
              setIsLongCaption(true);
            }
          }
        }}
      >
        {item.caption}
      </Text>
    );
  } else if (showFullCaption) {
    captionContent = (
      <>
        <Text style={styles.captionText}>{item.caption}</Text>
        <Text style={styles.readMoreText} onPress={() => setShowFullCaption(false)}>
          {t("caption_read_less") || "Read less"}
        </Text>
      </>
    );
  } else {
    captionContent = (
      <>
        <Text
          style={styles.captionText}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {item.caption}
        </Text>
        {isLongCaption && (
          <Text
            style={styles.readMoreText}
            onPress={() => setShowFullCaption(true)}
          >
            {t("caption_read_more")}
          </Text>
        )}
      </>
    );
  }

  return (
    <Pressable
      style={[styles.itemContainer, { height: itemHeight }]}
      {...pressableHandlers}
    >
      <VideoView
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        player={player}
        nativeControls={false}
        allowsPictureInPicture={false}
        onError={(e) =>
          console.log("VideoView onError for", item.id, e?.nativeEvent)
        }
      />

      {!overlayHiddenByHold && (
        <View
          style={[
            styles.bottomOverlay,
            {
              bottom: barVisible ? safeBottom + 40 : safeBottom + 24,
            },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.captionContainer}>
            <TouchableOpacity
              onPress={(e) => {
                stop(e);
                onAvatarPress && onAvatarPress();
              }}
              style={{ marginRight: 8 }}
            >
              <View style={styles.avatarDot} />
            </TouchableOpacity>
            <View style={styles.textBlock}>
              <Text style={styles.usernameText}>@{item.username}</Text>
              {captionContent}
            </View>
          </View>

          <View style={styles.actionsColumn}>
            <TouchableOpacity
              onPress={(e) => {
                stop(e);
                onShare();
              }}
              style={styles.actionButton}
            >
              <Image
                source={require("../../assets/share_white.png")}
                style={styles.shareIcon}
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={(e) => {
                stop(e);
                onToggleSave();
              }}
              style={styles.actionButton}
            >
              <Ionicons
                name={isSaved ? "bookmark" : "bookmark-outline"}
                size={26}
                color="#fff"
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={(e) => {
                stop(e);
                setMenuOpen(true);
              }}
              style={styles.actionButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="more-vertical" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {menuOpen && (
        <View style={styles.menuRoot} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.menuBackdrop}
            activeOpacity={1}
            onPress={() => setMenuOpen(false)}
          />
          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                onReportUser && onReportUser(item.userId);
              }}
            >
              <Feather
                name="alert-triangle"
                size={16}
                color="#333"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.menuText}>{t("feed_report_menu")}</Text>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                onBlockUser && onBlockUser(item.userId);
              }}
            >
              <Feather
                name="slash"
                size={16}
                color="#333"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.menuText}>{t("feed_block_menu")}</Text>
            </TouchableOpacity>

            {item.canDelete && <View style={styles.menuDivider} />}

            {item.canDelete && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  setConfirmOpen(true);
                }}
              >
                <Feather
                  name="x"
                  size={16}
                  color="#d23b3b"
                  style={{ marginRight: 8 }}
                />
                <Text style={[styles.menuText, { color: "#d23b3b" }]}>
                  {t("feed_delete_menu")}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* delete-confirm modal */}
      <Modal
        visible={confirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalOverlayTouch}
            activeOpacity={1}
            onPress={() => setConfirmOpen(false)}
          />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>
              {t("feed_delete_title")}
            </Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#d23b3b" }]}
                onPress={() => {
                  setConfirmOpen(false);
                  onDelete && onDelete(item.id);
                }}
              >
                <Text style={styles.confirmBtnText}>{t("confirm_yes")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: "#b0b6c0" }]}
                onPress={() => setConfirmOpen(false)}
              >
                <Text style={styles.confirmBtnText}>{t("confirm_no")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Pressable>
  );
}

export default function FeedScreen() {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { t } = useAlbaLanguage();

  const listRef = useRef(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [shareVisible, setShareVisible] = useState(false);
  const [savedIds, setSavedIds] = useState(new Set());
  const [viewHeight, setViewHeight] = useState(SCREEN_HEIGHT);

  const [barVisible, setBarVisible] = useState(true);
  const [pausedByHold, setPausedByHold] = useState(false);
  const [overlayHiddenByHold, setOverlayHiddenByHold] = useState(false);

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false); // ✅ start silent

  const [blockedUserIds, setBlockedUserIds] = useState([]);
  const [meId, setMeId] = useState(null);
  const [meUsername, setMeUsername] = useState(null);

  // report modal state
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportText, setReportText] = useState("");
  const [reportTargetUserId, setReportTargetUserId] = useState(null);
  const [reportTargetItem, setReportTargetItem] = useState(null);

  // block confirm modal state
  const [blockModalVisible, setBlockModalVisible] = useState(false);
  const [blockCandidateId, setBlockCandidateId] = useState(null);

  // toast state
  const [toastMessage, setToastMessage] = useState("");
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimeoutRef = useRef(null);

  // feed timer
  const timerEnabledRef = useRef(false);
  const alertMinutesRef = useRef(DEFAULT_ALERT_MINUTES);
  const elapsedRef = useRef(0);
  const [elapsedDisplay, setElapsedDisplay] = useState(0);
  const timerIntervalRef = useRef(null);
  const alertSentRef = useRef(false);
  const [timerAlertVisible, setTimerAlertVisible] = useState(false);
  const [timerAlertMinutes, setTimerAlertMinutes] = useState(DEFAULT_ALERT_MINUTES);
  const dataRef = useRef([]);
  const isGoingToFeedSettings = useRef(false);
  const isFocusedRef = useRef(isFocused);

  const [fontsLoaded] = useFonts({
    Poppins: require("../../assets/fonts/Poppins-Regular.ttf"),
  });

  // Keep dataRef in sync so useFocusEffect can check without stale closure
  useEffect(() => { dataRef.current = data; }, [data]);

  // Keep isFocusedRef current for AppState handler
  useEffect(() => { isFocusedRef.current = isFocused; }, [isFocused]);

  // Timer: starts/pauses via navigation focus/blur events and AppState.
  // Navigating to FeedSettings does NOT pause the timer.
  useEffect(() => {
    const startTimer = () => {
      if (!timerEnabledRef.current || timerIntervalRef.current) return;
      timerIntervalRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsedDisplay(elapsedRef.current);
        const limitSecs = alertMinutesRef.current * 60;
        if (!alertSentRef.current && elapsedRef.current >= limitSecs) {
          alertSentRef.current = true;
          setTimerAlertMinutes(alertMinutesRef.current);
          setTimerAlertVisible(true);
        }
      }, 1000);
    };

    const pauseTimer = () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };

    // Load settings then start — called on every focus so settings stay fresh
    const onFocus = async () => {
      try {
        const [enabled, mins] = await Promise.all([
          AsyncStorage.getItem(FEED_TIMER_ENABLED_KEY),
          AsyncStorage.getItem(FEED_TIMER_ALERT_MINUTES_KEY),
        ]);
        timerEnabledRef.current = enabled === "true";
        alertMinutesRef.current =
          parseInt(mins || String(DEFAULT_ALERT_MINUTES), 10) || DEFAULT_ALERT_MINUTES;
      } catch {}
      startTimer();
    };

    const onBlur = () => {
      if (isGoingToFeedSettings.current) {
        isGoingToFeedSettings.current = false;
        return; // keep timer running when entering FeedSettings
      }
      pauseTimer();
    };

    const unsubFocus = navigation.addListener("focus", onFocus);
    const unsubBlur = navigation.addListener("blur", onBlur);

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        pauseTimer();
      } else if (nextState === "active" && isFocusedRef.current) {
        startTimer();
      }
    });

    return () => {
      pauseTimer();
      unsubFocus();
      unsubBlur();
      appStateSub.remove();
    };
  }, [navigation]);

  // Sync barVisible → navigation params outside of any render or setState updater
  useEffect(() => {
    navigation.setParams({ fullscreenFeed: !barVisible });
  }, [barVisible, navigation]);

  const showToast = useCallback(
    (msg) => {
      if (!msg) return;
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      setToastMessage(msg);
      toastOpacity.stopAnimation();
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }).start();

      toastTimeoutRef.current = setTimeout(() => {
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }).start(() => {
          setToastMessage("");
        });
      }, 2000);
    },
    [toastOpacity]
  );

  React.useEffect(
    () => () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      // ✅ 0) instant cache paint (no network)
      (async () => {
        try {
          const cached = await readCachedFirstFeedVideoOverride();
          if (!isActive || !cached?.cachedVideo) return;

          setData((prev) => {
            if (Array.isArray(prev) && prev.length) return prev;
            return [
              {
                id: String(cached.id),
                userId: cached.userId || null,
                username: cached.username || (cached.userId || "alba_user"),
                caption: cached.caption || "",
                videoUrl: cached.cachedVideo, // ✅ local file://
                canDelete: false,
              },
            ];
          });

          setCurrentIndex(0);
          setLoading(false);
        } catch (e) {}
      })();

      const loadAll = async () => {
        try {
          // keep loading “silent” if we already rendered cached video
          setLoading((prev) => (data?.length ? false : true));

          const {
            data: { user },
            error: userError,
          } = await supabase.auth.getUser();

          if (userError) {
            console.warn("Error getting auth user in FeedScreen:", userError);
          }

          if (!isActive) return;

          if (user) {
            setMeId(user.id);
          } else {
            setMeId(null);
            setMeUsername(null);
          }

          let blocked = [];
          let myUsername = null;
          let feedTags = [];
          let feedEmbedding = null;
          let feedRadiusKm = null;

          if (user) {
            const { data: profile, error: profileError } = await supabase
              .from("profiles")
              .select("blocked_users, username, saved_feed_videos, feed_tags, feed_preference_embedding, feed_radius_km")
              .eq("id", user.id)
              .single();

            if (!profileError && profile) {
              blocked = profile.blocked_users || [];
              myUsername = profile.username || null;
              feedTags = profile.feed_tags || [];
              feedRadiusKm = profile.feed_radius_km || null;
              // embedding is stored as a string like "[0.1, 0.2, ...]" — parse it
              if (profile.feed_preference_embedding) {
                try {
                  feedEmbedding = typeof profile.feed_preference_embedding === "string"
                    ? JSON.parse(profile.feed_preference_embedding)
                    : profile.feed_preference_embedding;
                } catch {}
              }
              if (Array.isArray(profile.saved_feed_videos)) {
                setSavedIds(new Set(profile.saved_feed_videos.map(String)));
              }
            } else if (profileError) {
              console.warn("Error loading profile in FeedScreen:", profileError);
            }
          }

          if (!isActive) return;

          setBlockedUserIds(blocked);
          setMeUsername(myUsername);

          // ✅ if cached first is blocked, drop it
          setData((prev) => {
            if (!Array.isArray(prev) || !prev.length) return prev;
            const first = prev[0];
            if (first?.userId && blocked.includes(first.userId)) return [];
            return prev;
          });

          // Personalized feed: use RPC when any preference is set
          const hasPersonalization = feedEmbedding || feedTags.length > 0 || feedRadiusKm;

          let rows = null;
          let error = null;

          if (hasPersonalization && user) {
            let userLat = null;
            let userLng = null;

            if (feedRadiusKm) {
              try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === "granted") {
                  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                  userLat = pos.coords.latitude;
                  userLng = pos.coords.longitude;
                }
              } catch {}
            }

            const { data: rpcRows, error: rpcError } = await supabase.rpc("get_personalized_feed", {
              uid: user.id,
              query_embedding: feedEmbedding || null,
              preferred_tags: feedTags.length > 0 ? feedTags : [],
              user_lat: userLat,
              user_lng: userLng,
              radius_km: feedRadiusKm || null,
              match_count: 30,
            });

            rows = rpcRows;
            error = rpcError;

            // If personalized RPC returned nothing (tags/radius too strict, or no
            // embeddings yet), fall back to the plain chronological feed so the
            // user never sees an empty screen just because preferences are set.
            if (!error && (!rows || rows.length === 0)) {
              const { data: fallbackRows, error: fallbackError } = await supabase
                .from("feed_videos")
                .select("id, user_id, username, caption, video_storage_path, created_at")
                .order("created_at", { ascending: false })
                .limit(30);
              rows = fallbackRows;
              error = fallbackError;
            }
          } else {
            const { data: tableRows, error: tableError } = await supabase
              .from("feed_videos")
              .select("id, user_id, username, caption, video_storage_path, created_at")
              .order("created_at", { ascending: false })
              .limit(30);

            rows = tableRows;
            error = tableError;
          }

          if (error) {
            console.error("Error loading feed videos:", error);
            return;
          }

          if (!isActive) return;

          // In feed_videos, user_id stores the poster's username (not a UUID)
          const visibleRows = (rows || []).filter((row) => !blocked.includes(row.user_id));

          const rawMapped = visibleRows
              .map((row) => {
                const videoUrl = resolveVideoUrl(row.video_storage_path);
                if (!videoUrl) return null;
                return {
                  id: String(row.id),
                  userId: row.user_id,
                  username: row.user_id || row.username || "user",
                  caption: row.caption || "",
                  videoUrl,
                  canDelete: !!user?.id && row.user_id === user.id,
                };
              })
              .filter(Boolean) || [];

          // Swap in local cached URLs where available — avoids CDN round-trips
          const mapped = await Promise.all(
            rawMapped.map(async (item) => {
              const localUrl = await getCachedVideoUrl(item.id, item.videoUrl);
              return localUrl ? { ...item, videoUrl: localUrl } : item;
            })
          );

          // Queue background downloads for the first 5 remote (uncached) videos
          const toCache = mapped
            .filter((item) => !String(item.videoUrl).startsWith("file://"))
            .slice(0, 5);
          cacheVideosInBackground(toCache).catch(() => {});

          // ✅ KEY FIX:
          // If we're currently showing a cached first video (file://) and it matches
          // Supabase's first item by id, keep cached[0] and append from mapped[1].
          setData((prev) => {
            const prevFirst = Array.isArray(prev) && prev.length ? prev[0] : null;
            const prevHasCachedFirst =
              !!prevFirst?.videoUrl && String(prevFirst.videoUrl).startsWith("file://");

            if (!prevHasCachedFirst) {
              return mapped;
            }

            const supaFirst = mapped?.[0] || null;

            // If Supabase has nothing (or doesn't match), replace with mapped (cache likely stale)
            if (!supaFirst) return mapped;

            if (String(supaFirst.id) === String(prevFirst.id)) {
              // keep cached first, append from second onward
              return [prevFirst, ...mapped.slice(1)];
            }

            // mismatch -> replace (better to be correct than keep wrong cached)
            return mapped;
          });

          // Don't forcibly reset index here (avoids any extra jank)
          // setCurrentIndex(0);

          // ✅ warm first-video cache from Supabase first item (remote), if present
          if (mapped?.length) {
            cacheFirstFeedVideoFromList(mapped[0]).catch(() => {});
          }
        } finally {
          if (isActive) setLoading(false);
        }
      };

      setBarVisible(true);
      setPausedByHold(false);
      setOverlayHiddenByHold(false);

      // Skip network reload if we already have data (e.g. returning from UseTime/FeedSettings)
      if (dataRef.current?.length > 0) return;

      loadAll();

      return () => {
        isActive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigation])
  );

  const handleDeleteVideo = useCallback(
    async (id) => {
      if (!id) return;
      try {
        const { error } = await supabase
          .from("feed_videos")
          .delete()
          .eq("id", id);

        if (error) {
          console.warn("Error deleting feed video:", error);
          showToast(t("feed_couldnt_delete"));
          return;
        }

        const filtered = data.filter((item) => item.id !== String(id));
        setData(filtered);

        if (filtered.length === 0) {
          setCurrentIndex(0);
          showToast(t("feed_deleted_toast"));
          return;
        }

        const nextIndex = Math.min(currentIndex, filtered.length - 1);
        setCurrentIndex(nextIndex);

        if (listRef.current) {
          try {
            listRef.current.scrollToIndex({ index: nextIndex, animated: true });
          } catch (e) {
            console.warn("scrollToIndex after delete failed", e);
          }
        }

        showToast(t("feed_deleted_toast"));
      } catch (e) {
        console.warn("Unexpected error deleting feed video:", e);
        showToast(t("feed_couldnt_delete"));
      }
    },
    [data, currentIndex, showToast]
  );

  const handleMomentumEnd = (event) => {
    const { contentOffset, layoutMeasurement } = event.nativeEvent;
    const offsetY = contentOffset.y;
    const pageHeight = layoutMeasurement.height || viewHeight;
    const newIndex = Math.round(offsetY / pageHeight);
    if (newIndex !== currentIndex) {
      setCurrentIndex(newIndex);
    }

    setPausedByHold(false);
    setOverlayHiddenByHold(false);

    if (barVisible) {
      setBarVisible(false);
    }
  };

  const handleToggleSave = useCallback((id) => {
    setSavedIds((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      const newIds = Array.from(copy);
      if (meId) {
        supabase
          .from("profiles")
          .update({ saved_feed_videos: newIds })
          .eq("id", meId)
          .then(() => {});
      }
      return copy;
    });
  }, [meId]);

  const handleTap = () => {
    setBarVisible((prev) => !prev);
  };

  const handleLongPress = () => {
    setPausedByHold(true);
    setOverlayHiddenByHold(true);
  };

  const handlePressOut = () => {
    if (pausedByHold || overlayHiddenByHold) {
      setPausedByHold(false);
      setOverlayHiddenByHold(false);
    }
  };

  const applyBlockUser = async (userId) => {
    if (!userId) return;

    showToast(t("feed_blocked_toast"));

    const updatedBlocked = Array.from(new Set([...(blockedUserIds || []), userId]));
    setBlockedUserIds(updatedBlocked);

    if (meId) {
      const { error } = await supabase
        .from("profiles")
        .update({ blocked_users: updatedBlocked })
        .eq("id", meId);

      if (error) {
        console.warn("Failed to update blocked_users on profile:", error);
      }
    }

    const filtered = data.filter((item) => item.userId !== userId);
    setData(filtered);

    if (filtered.length === 0) {
      setCurrentIndex(0);
      return;
    }

    const nextIndex = Math.min(currentIndex, filtered.length - 1);
    setCurrentIndex(nextIndex);
    if (listRef.current) {
      try {
        listRef.current.scrollToIndex({ index: nextIndex, animated: true });
      } catch (e) {
        console.warn("scrollToIndex failed", e);
      }
    }
  };

  const requestBlockUser = (userId) => {
    if (!userId) return;
    setBlockCandidateId(userId);
    setBlockModalVisible(true);
  };

  const cancelBlockUser = () => {
    setBlockCandidateId(null);
    setBlockModalVisible(false);
  };

  const confirmBlockUser = async () => {
    if (!blockCandidateId) {
      cancelBlockUser();
      return;
    }
    const target = blockCandidateId;
    setBlockCandidateId(null);
    setBlockModalVisible(false);
    await applyBlockUser(target);
  };

  const handleReportUser = (userId) => {
    const item = data.find((d) => d.userId === userId) || null;
    setReportTargetUserId(userId);
    setReportTargetItem(item);
    setReportText("");
    setReportModalVisible(true);
  };

  const handleSendReport = async () => {
    setReportModalVisible(false);
    const item = reportTargetItem;
    const text = reportText.trim();
    setReportText("");
    setReportTargetItem(null);

    try {
      await supabase.from("reports").insert({
        reported_by: meId,
        reason: `Feed video by @${item?.username ?? "unknown"}: "${(item?.caption ?? "").slice(0, 80)}" — ${text || "no reason"}`,
      });
    } catch {}

    try {
      await supabase.functions.invoke("send-report", {
        body: {
          type: "feed_video",
          reported_by_id: meId,
          reported_by_username: meUsername,
          reason: text,
          poster_user_id: reportTargetUserId,
          context: {
            video_id: item?.id,
            video_caption: item?.caption,
            video_poster_username: item?.username,
          },
        },
      });
    } catch {}

    showToast(t("feed_reported_toast"));
  };

  const handleCancelReport = () => {
    setReportModalVisible(false);
    setReportText("");
    setReportTargetItem(null);
  };

  const currentItem = data[currentIndex];

  const showInitialLoader = !!loading && (!Array.isArray(data) || data.length === 0);

  return (
    <SafeAreaView style={styles.container} edges={["left", "right"]}>
      <View style={{ flex: 1 }}>
        {!overlayHiddenByHold && (
          <View
            style={[
              styles.topBar,
              {
                top: insets.top + 8,
              },
            ]}
          >
            <TouchableOpacity
              onPress={() => navigation.navigate("UseTime")}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Image
                source={require("../../assets/phone_white.png")}
                style={styles.topIcon}
              />
            </TouchableOpacity>

            {timerEnabledRef.current && elapsedDisplay > 0 && (
              <View style={styles.timerWrap}>
                <Text style={styles.timerText}>
                  {Math.floor(elapsedDisplay / 60)}:{String(elapsedDisplay % 60).padStart(2, "0")}
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={() => {
                isGoingToFeedSettings.current = true;
                navigation.navigate("FeedSettings");
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather name="settings" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {showInitialLoader ? (
          <View style={styles.emptyState}>
            <Text style={{ color: "#fff" }}>{t("feed_loading")}</Text>
          </View>
        ) : data.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={{ color: "#fff" }}>{t("feed_no_videos")}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={data}
            keyExtractor={(item) => item.id}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h && h !== viewHeight) setViewHeight(h);
            }}
            onMomentumScrollEnd={handleMomentumEnd}
            renderItem={({ item, index }) => (
              <FeedItem
                item={item}
                isActive={index === currentIndex}
                isPreloading={index === currentIndex + 1}
                isSaved={savedIds.has(item.id)}
                isScreenFocused={isFocused}
                itemHeight={viewHeight}
                barVisible={barVisible}
                pausedByHold={pausedByHold && index === currentIndex}
                overlayHiddenByHold={overlayHiddenByHold && index === currentIndex}
                safeBottom={insets.bottom}
                onShare={() => setShareVisible(true)}
                onToggleSave={() => handleToggleSave(item.id)}
                onTap={handleTap}
                onLongPress={handleLongPress}
                onPressOut={handlePressOut}
                onBlockUser={requestBlockUser}
                onReportUser={handleReportUser}
                onAvatarPress={() =>
                  navigation.navigate("Profile", {
                    userId: item.userId,
                    username: item.username,
                  })
                }
                onDelete={handleDeleteVideo}
              />
            )}
          />
        )}

        {currentItem && (
          <ShareMenu
            visible={shareVisible}
            onClose={() => setShareVisible(false)}
            postId={currentItem.id}
            isVideo={true}
          />
        )}
      </View>

      {/* Report modal */}
      <Modal
        visible={reportModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCancelReport}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.reportCard}>
            <Text style={styles.reportTitle}>
              {t("feed_report_title")}
            </Text>
            <TextInput
              style={styles.reportInput}
              multiline
              value={reportText}
              onChangeText={setReportText}
              placeholder={t("feed_report_placeholder")}
              placeholderTextColor="#999"
            />
            <View style={styles.reportButtonsRow}>
              <TouchableOpacity
                style={[styles.reportBtn, styles.reportCancelBtn]}
                onPress={handleCancelReport}
              >
                <Text style={styles.reportBtnText}>{t("cancel_button")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportBtn, styles.reportSendBtn]}
                onPress={handleSendReport}
              >
                <Text style={[styles.reportBtnText, { color: "#fff" }]}>
                  {t("submit_button")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Block confirm modal */}
      <Modal
        visible={blockModalVisible}
        transparent
        animationType="fade"
        onRequestClose={cancelBlockUser}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.blockCard}>
            <Text style={styles.blockTitle}>
              {t("feed_block_title")}
            </Text>
            <View style={styles.blockButtonsRow}>
              <TouchableOpacity
                style={[styles.blockBtnSmall, styles.blockNoBtn]}
                onPress={cancelBlockUser}
              >
                <Text style={styles.blockBtnSmallText}>{t("confirm_no")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.blockBtnSmall, styles.blockYesBtn]}
                onPress={confirmBlockUser}
              >
                <Text style={[styles.blockBtnSmallText, { color: "#fff" }]}>
                  {t("confirm_yes")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Timer break alert */}
      <Modal
        visible={timerAlertVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTimerAlertVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.timerAlertCard}>
            <Text style={styles.timerAlertTitle}>{t("feed_break_title")}</Text>
            <Text style={styles.timerAlertMessage}>
              {t("feed_break_message").replace("{n}", timerAlertMinutes)}
            </Text>
            <TouchableOpacity
              style={styles.timerAlertOkBtn}
              onPress={() => setTimerAlertVisible(false)}
            >
              <Text style={styles.timerAlertOkText}>{t("ok_button")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Toast */}
      {toastMessage ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toast,
            {
              opacity: toastOpacity,
            },
          ]}
        >
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      ) : null}

      <OnboardingOverlay screenKey="feed" />
    </SafeAreaView>
  );
}

/* -------- styles -------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  topBar: {
    position: "absolute",
    left: 14,
    right: 14,
    zIndex: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  topIcon: {
    width: 22,
    height: 22,
    resizeMode: "contain",
  },
  timerWrap: {
    backgroundColor: "#000",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  timerText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "PoppinsBold",
  },
  itemContainer: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000",
  },
  bottomOverlay: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  captionContainer: {
    flexDirection: "row",
    flex: 1,
  },
  avatarDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#3D8BFF",
    marginTop: 2,
  },
  textBlock: {
    flexShrink: 1,
  },
  usernameText: {
    color: "#fff",
    marginBottom: 4,
    fontFamily: "PoppinsBold",
  },
  captionText: {
    color: "#fff",
    opacity: 0.9,
    fontSize: 13,
    fontFamily: "Poppins",
  },
  readMoreText: {
    color: "#fff",
    opacity: 0.9,
    fontSize: 12,
    marginTop: 2,
    fontFamily: "PoppinsBold",
  },
  actionsColumn: {
    marginLeft: 16,
    alignItems: "center",
  },
  actionButton: {
    marginBottom: 18,
  },
  shareIcon: {
    width: 26,
    height: 26,
    resizeMode: "contain",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  menuRoot: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
  menuCard: {
    position: "absolute",
    bottom: 100,
    right: 12,
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 6,
    minWidth: 180,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
  },
  menuItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  menuText: {
    fontSize: 14,
    color: "#111",
    fontFamily: "Poppins",
  },
  menuDivider: {
    height: 1,
    backgroundColor: "#eceff3",
    marginVertical: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalOverlayTouch: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  confirmCard: {
    width: "82%",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
  },
  confirmTitle: {
    fontSize: 16,
    textAlign: "center",
    color: "#111",
    marginBottom: 14,
    fontFamily: "Poppins",
  },
  confirmRow: {
    flexDirection: "row",
    width: "100%",
    justifyContent: "space-between",
    columnGap: 10,
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  confirmBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "PoppinsBold",
  },

  reportCard: {
    width: "85%",
    backgroundColor: "#101218",
    borderRadius: 18,
    padding: 16,
  },
  reportTitle: {
    fontSize: 16,
    fontFamily: "PoppinsBold",
    color: "#fff",
    marginBottom: 10,
  },
  reportInput: {
    minHeight: 90,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: "Poppins",
    textAlignVertical: "top",
    borderColor: "#444",
    backgroundColor: "#181b22",
    color: "#fff",
    marginBottom: 14,
  },
  reportButtonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    columnGap: 10,
  },
  reportBtn: {
    minWidth: 80,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  reportCancelBtn: {
    borderWidth: 0.5,
    borderColor: "#888",
    backgroundColor: "transparent",
  },
  reportSendBtn: {
    backgroundColor: "#12A7E0",
  },
  reportBtnText: {
    fontSize: 14,
    fontFamily: "Poppins",
    color: "#fff",
  },

  blockCard: {
    width: "80%",
    backgroundColor: "#101218",
    borderRadius: 18,
    padding: 16,
  },
  blockTitle: {
    fontSize: 15,
    fontFamily: "PoppinsBold",
    color: "#fff",
    marginBottom: 12,
  },
  blockButtonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    columnGap: 10,
  },
  blockBtnSmall: {
    minWidth: 70,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  blockNoBtn: {
    borderWidth: 0.5,
    borderColor: "#6F7D95",
    backgroundColor: "transparent",
  },
  blockYesBtn: {
    backgroundColor: "#12A7E0",
  },
  blockBtnSmallText: {
    fontSize: 14,
    fontFamily: "Poppins",
    color: "#fff",
  },

  toast: {
    position: "absolute",
    bottom: 80,
    alignSelf: "center",
    maxWidth: "80%",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.75)",
  },
  toastText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontFamily: "Poppins",
    textAlign: "center",
  },

  timerAlertCard: {
    width: "78%",
    backgroundColor: "#101218",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    elevation: 4,
  },
  timerAlertTitle: {
    fontFamily: "PoppinsBold",
    fontSize: 16,
    color: "#fff",
    textAlign: "center",
    marginBottom: 8,
  },
  timerAlertMessage: {
    fontFamily: "Poppins",
    fontSize: 14,
    color: "#fff",
    textAlign: "center",
    marginBottom: 20,
  },
  timerAlertOkBtn: {
    backgroundColor: "#4EBCFF",
    paddingVertical: 10,
    paddingHorizontal: 36,
    borderRadius: 12,
  },
  timerAlertOkText: {
    color: "#fff",
    fontFamily: "PoppinsBold",
    fontSize: 15,
  },
});

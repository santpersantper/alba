// components/chat/ChatTab.js
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Image as ExpoImage } from "expo-image"; // ✅ disk caching
import { useAlbaTheme } from "../../theme/ThemeContext";


export default function ChatTab({
  type = "single",
  name,
  avatarUri,
  initials,
  lastMessage,
  lastSender = "other",
  lastDate,
  lastTime,
  displayTime,
  unreadCount = 0,
  onPress,
  onLongPress,
}) {
  const { theme, isDark } = useAlbaTheme();

  const isUnread = unreadCount > 0;

  const fallbackLetters = (initials || name?.[0] || "?").slice(0, 2);

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.8}
      style={[styles.row, { backgroundColor: theme.gray }]}
    >
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        {avatarUri ? (
          <ExpoImage
            source={{ uri: avatarUri }}
            style={styles.avatarImg}
            contentFit="cover"
            cachePolicy="disk" // ✅ persists
            transition={0}     // ✅ no fade-in pop
          />
        ) : (
          <View
            style={[
              styles.avatarCircle,
              { backgroundColor: isDark ? "#2a2a2a" : "#EAEFF5" },
            ]}
          >
            <Text
              style={[
                styles.avatarText,
                { color: isDark ? "#E3E7F0" : "#555" },
              ]}
            >
              {fallbackLetters}
            </Text>
          </View>
        )}

        {/* online dot (keep your current behavior) */}
        <View style={[styles.onlineDot, { borderColor: theme.gray }]} />
      </View>

      {/* Center */}
      <View style={styles.center}>
        <Text
          numberOfLines={1}
          style={[styles.name, { color: theme.text }, isUnread && styles.nameUnread]}
        >
          {name}
        </Text>

        <Text
          numberOfLines={1}
          style={[
            styles.last,
            { color: isDark ? "#C5CAD3" : "#7E8A97" },
            isUnread && styles.lastUnread,
          ]}
        >
          {lastMessage}
        </Text>
      </View>

      {/* Right */}
      <View style={styles.right}>
        {!!displayTime && (
          <Text style={[styles.time, { color: isDark ? "#A0A4AE" : "#A1A8B0" }]}>
            {displayTime}
          </Text>
        )}
        {isUnread && <View style={styles.unreadDot} />}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },

  avatarWrap: { marginRight: 12 },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: { width: 44, height: 44, borderRadius: 22 },
  avatarText: {
    fontFamily: "PoppinsBold",
    fontSize: 16,
  },

  onlineDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#20C15A",
    borderWidth: 2,
  },

  center: { flex: 1 },

  name: {
    fontSize: 15,
    fontFamily: "PoppinsBold",
  },
  nameUnread: {
    fontFamily: "PoppinsBold",
  },

  last: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: "Poppins",
  },
  lastUnread: {
    fontFamily: "PoppinsBold",
  },

  right: {
    alignItems: "flex-end",
    gap: 6,
  },

  time: {
    fontSize: 12,
    fontFamily: "Poppins",
  },

  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#6BDCFF",
  },
});

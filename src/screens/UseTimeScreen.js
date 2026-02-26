import React, { useState, useRef } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StatusBar,
  Image,
  PanResponder
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";

export default function UseTimeScreen() {
  const [weeklyGoal, setWeeklyGoal] = useState("10% reduction per week");
  const [dailyGoal, setDailyGoal] = useState("Less than 3 hs a day");
  const [editingGoalKey, setEditingGoalKey] = useState(null);
  const navigation = useNavigation();

const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 10 && Math.abs(gesture.dy) < 10, // mostly horizontal
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx < -60) {
          // swipe left
          navigation.goBack();
        }
      },
    })
  ).current;

  const renderGoalRow = (label, value, isEditing, onChangeValue, onPressChange) => (
    <View style={styles.goalRow}>
      {isEditing ? (
        <TextInput
          style={[styles.goalText, styles.goalInput]}
          value={value}
          onChangeText={onChangeValue}
          autoFocus
        />
      ) : (
        <Text style={styles.goalText}>{value}</Text>
      )}
      <TouchableOpacity onPress={onPressChange} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.changeText}>{isEditing ? "Save" : "Change"}</Text>
      </TouchableOpacity>
    </View>
  );

  const handleToggleEdit = (key) => {
    if (editingGoalKey === key) setEditingGoalKey(null);
    else setEditingGoalKey(key);
  };

  return (
    <LinearGradient
      colors={["#00D36F", "#00B249"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
      {...panResponder.panHandlers}
    >
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* Title */}
          <Text style={styles.bigTitle}>
            You're on your way{"\n"}
            to meet your goal,{"\n"}
            keep it up! 💪
          </Text>

          {/* Stats */}
          <View style={styles.statsBlock}>
            <View style={styles.statRow}>
              <Image
                source={require("../../assets/downward_white.png")}
                style={styles.smallIcon}
              />
              <Text style={styles.statNumber}>4.12%</Text>
              <Text style={styles.statLabel}>since last Friday</Text>
            </View>
            <View style={styles.statRow}>
              <Image
                source={require("../../assets/downward_white.png")}
                style={styles.smallIcon}
              />
              <Text style={styles.statNumber}>5.39%</Text>
              <Text style={styles.statLabel}>since yesterday</Text>
            </View>
            <View style={styles.statRow}>
              <Image
                source={require("../../assets/chart_white.png")}
                style={styles.smallIcon}
              />
              <Text style={styles.statLabel}>
                <Text style={styles.statBold}>4 straight days</Text> keeping your goal
              </Text>
            </View>
          </View>

          {/* Days row (checks stay as icons) */}
          <View style={styles.daysRow}>
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, idx) => {
              const filled = idx < 4;
              return (
                <View key={d} style={styles.dayItem}>
                  <View style={[styles.dayCircle, filled && styles.dayCircleFilled]}>
                    {filled && <Feather name="check" size={16} color="#00D36F" />}
                  </View>
                  <Text style={styles.dayLabel}>{d}</Text>
                </View>
              );
            })}
          </View>

          {/* Goals */}
          <View style={styles.goalsBlock}>
            <Text style={styles.sectionTitle}>My current goals:</Text>

            {renderGoalRow(
              "weekly",
              weeklyGoal,
              editingGoalKey === "weekly",
              setWeeklyGoal,
              () => handleToggleEdit("weekly")
            )}

            {renderGoalRow(
              "daily",
              dailyGoal,
              editingGoalKey === "daily",
              setDailyGoal,
              () => handleToggleEdit("daily")
            )}
          </View>

          {/* Today card */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Social media time today</Text>
            <Text style={styles.cardMainTime}>1h 59 min</Text>

            <View style={styles.appsRow}>
              <View style={styles.appItem}>
                <Image
                  source={require("../../assets/instagram_white.png")}
                  style={styles.appIcon}
                />
                <Text style={styles.appTime}>1h 2 min</Text>
              </View>
              <View style={styles.appItem}>
                <Image
                  source={require("../../assets/tiktok_white.png")}
                  style={styles.appIcon}
                />
                <Text style={styles.appTime}>34 min</Text>
              </View>
              <View style={styles.appItem}>
                <Image
                  source={require("../../assets/twitter_white.png")}
                  style={styles.appIcon}
                />
                <Text style={styles.appTime}>23 min</Text>
              </View>
            </View>
          </View>

          {/* Week card */}
          <View style={[styles.card, { marginBottom: 32 }]}>
            <Text style={styles.cardLabel}>Social media time this week</Text>
            <Text style={styles.cardMainTime}>5h 59 min</Text>

            <View style={styles.appsRow}>
              <View style={styles.appItem}>
                <Image
                  source={require("../../assets/instagram_white.png")}
                  style={styles.appIcon}
                />
                <Text style={styles.appTime}>3 hr 2 min</Text>
              </View>
              <View style={styles.appItem}>
                <Image
                  source={require("../../assets/tiktok_white.png")}
                  style={styles.appIcon}
                />
                <Text style={styles.appTime}>2 hr 2 min</Text>
              </View>
              <View style={styles.appItem}>
                <Image
                  source={require("../../assets/twitter_white.png")}
                  style={styles.appIcon}
                />
                <Text style={styles.appTime}>55 min</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  bigTitle: {
    fontFamily: "Poppins",
    fontWeight: 700,
    fontSize: 35,
    color: "#FFFFFF",
    marginTop: 24,
    marginBottom: 20,
  },
  statsBlock: {
    marginBottom: 24,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  statNumber: {
    fontFamily: "Poppins",
    fontWeight: 700,
    fontSize: 20,
    color: "#FFFFFF",
    marginHorizontal: 4,
  },
  statLabel: {
    fontFamily: "Poppins",
    fontSize: 20,
    color: "#FFFFFF",
    fontWeight: 200,
    marginHorizontal: 10,
  },
  statBold: {
    fontFamily: "Poppins",
    fontWeight: 700,
  },
  daysRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 26,
    marginTop: 4,
    paddingLeft: 10,
    paddingRight: 10,
  },
  dayItem: {
    alignItems: "center",
  },
  dayCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.8)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  dayCircleFilled: {
    backgroundColor: "#FFFFFF",
  },
  dayLabel: {
    fontFamily: "Poppins",
    fontSize: 14,
    color: "#FFFFFF",
  },
  goalsBlock: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontFamily: "Poppins",
    fontSize: 20,
    color: "#FFFFFF",
    marginBottom: 8,
    fontWeight: 700,
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  goalText: {
    flex: 1,
    fontFamily: "Poppins",
    fontSize: 18,
    color: "#FFFFFF",
  },
  goalInput: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  changeText: {
    fontFamily: "Poppins",
    fontSize: 18,
    color: "grey",
    marginLeft: 10,
  },
  card: {
    backgroundColor: "rgba(0, 180, 73, 0.95)",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 14,
  },
  cardLabel: {
    fontFamily: "Poppins",
    fontSize: 13,
    color: "#FFFFFF",
    marginBottom: 6,
    fontWeight: 700,
  },
  cardMainTime: {
    fontFamily: "Poppins",
    fontSize: 32,
    color: "#FFFFFF",
    marginBottom: 12,
  },
  appsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  appItem: {
    alignItems: "center",
    flex: 1,
  },
  appTime: {
    marginTop: 4,
    fontFamily: "Poppins",
    fontSize: 14,
    color: "#FFFFFF",
  },
  smallIcon: {
    width: 20,
    height: 20,
    resizeMode: "contain",
  },
  appIcon: {
    width: 28,
    height: 28,
    resizeMode: "contain",
    marginBottom: 2,
  },
});

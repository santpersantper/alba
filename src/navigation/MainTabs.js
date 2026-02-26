import React, { useEffect } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import FeedScreen from "../screens/FeedScreen";
import CommunityScreen from "../screens/CommunityScreen";
import CreatePostScreen from "../screens/CreatePostScreen";
import NavigationBar from "../components/NavigationBar";
import { warmAuthCache } from "../lib/authFast";

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  useEffect(() => {
    warmAuthCache(); // best-effort prefetch
  }, []);

  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <NavigationBar {...props} />}
    >
      <Tab.Screen name="Community" component={CommunityScreen} />
      <Tab.Screen name="CreatePost" component={CreatePostScreen} />
      <Tab.Screen name="Feed" component={FeedScreen} />
    </Tab.Navigator>
  );
}

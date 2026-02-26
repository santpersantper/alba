import React from "react";
import { Text } from "react-native";
import { useAlbaTheme } from "../theme/ThemeContext";

export default function ThemedText({ style, ...props }) {
  const { theme } = useAlbaTheme();
  return <Text style={[{ color: theme.text }, style]} {...props} />;
}

import React from "react";
import { View } from "react-native";
import { useAlbaTheme } from "../theme/ThemeContext";

export default function ThemedView({ style, variant = "background", ...props }) {
  const { theme } = useAlbaTheme();
  const bg =
    variant === "card"
      ? theme.card
      : variant === "gray"
      ? theme.gray
      : theme.background;

  return <View style={[{ backgroundColor: bg }, style]} {...props} />;
}

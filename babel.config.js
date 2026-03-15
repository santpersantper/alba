module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Required for react-native-reanimated 4.x / react-native-worklets:
      // transforms worklet-directive functions to run on the UI thread.
      // Must be listed last.
      'react-native-worklets/plugin',
    ],
  };
};

import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAlbaTheme } from '../theme/ThemeContext';
import { useAlbaLanguage } from '../theme/LanguageContext';

export default function GuestUpgradeModal({ visible, onClose, navigation }) {
  const { isDark } = useAlbaTheme();
  const { t } = useAlbaLanguage();

  const bg = isDark ? '#2a2a2a' : '#FFFFFF';
  const fg = isDark ? '#FFFFFF' : '#111111';
  const sub = isDark ? '#aaa' : '#555';

  const handleOk = () => {
    onClose?.();
    navigation?.navigate('CommunitySettings');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: bg }]}>
          <Text style={[styles.title, { color: fg }]}>
            {t('guest_upgrade_title') || 'Create your own profile and become part of Alba!'}
          </Text>
          <TouchableOpacity style={styles.btn} onPress={handleOk}>
            <Text style={styles.btnText}>
              {t('guest_upgrade_ok') || 'OK'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    elevation: 6,
  },
  title: {
    fontFamily: 'PoppinsBold',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 24,
  },
  btn: {
    backgroundColor: '#00A9FF',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 48,
  },
  btnText: {
    fontFamily: 'PoppinsBold',
    fontSize: 14,
    color: '#fff',
  },
});

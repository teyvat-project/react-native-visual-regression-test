import { StyleSheet, Text, View } from 'react-native';

const colors = {
  info: { background: '#e7f5ff', text: '#1864ab' },
  success: { background: '#ebfbee', text: '#2b8a3e' },
  danger: { background: '#fff5f5', text: '#c92a2a' },
};

export type BadgeProps = { label: string; tone?: keyof typeof colors };

export function Badge({ label, tone = 'info' }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: colors[tone].background }]}>
      <Text style={[styles.label, { color: colors[tone].text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
});

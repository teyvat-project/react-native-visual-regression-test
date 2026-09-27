import { Pressable, StyleSheet, Text } from 'react-native';

export type ButtonProps = {
  label: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  onPress?: () => void;
};

export function Button({ label, variant = 'primary', disabled = false, onPress }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.base, variant === 'primary' ? styles.primary : styles.secondary, disabled && styles.disabled]}
    >
      <Text style={[styles.label, variant === 'secondary' && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: 8, paddingHorizontal: 20, paddingVertical: 12, borderWidth: 2 },
  primary: { backgroundColor: '#3b5bdb', borderColor: '#3b5bdb' },
  secondary: { backgroundColor: '#ffffff', borderColor: '#3b5bdb' },
  disabled: { opacity: 0.4 },
  label: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  secondaryLabel: { color: '#3b5bdb' },
});

import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { useVrtPending } from '@natsuneko-laboratory/react-native-visual-regression-test';

export type CardProps = {
  title: string;
  body: string;
  image?: ImageSourcePropType;
  loading?: boolean;
};

export function Card({ title, body, image, loading = false }: CardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  // Hold the screenshot until the image has been decoded and drawn.
  useVrtPending(!!image && !imageLoaded);

  return (
    <View style={styles.card}>
      {image ? <Image source={image} style={styles.image} onLoad={() => setImageLoaded(true)} /> : null}
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {loading ? <ActivityIndicator style={styles.spinner} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: 280, borderRadius: 12, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#dee2e6', overflow: 'hidden' },
  image: { width: 280, height: 140 },
  content: { padding: 16, gap: 6 },
  title: { fontSize: 18, fontWeight: '700', color: '#212529' },
  body: { fontSize: 14, lineHeight: 20, color: '#495057' },
  spinner: { alignSelf: 'flex-start', marginTop: 8 },
});

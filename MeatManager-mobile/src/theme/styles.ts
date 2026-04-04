import { StyleSheet } from 'react-native';
import { palette } from './palette';

export const globalStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.background
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 16
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: palette.text
  },
  subtitle: {
    fontSize: 14,
    color: palette.textMuted,
    lineHeight: 20
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 18,
    gap: 10
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: palette.text
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  }
});

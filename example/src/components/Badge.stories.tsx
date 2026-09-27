import type { Meta, StoryObj } from '@storybook/react-native';
import { Badge } from './Badge';

const meta = {
  title: 'Badge',
  component: Badge,
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = { args: { label: 'NEW', tone: 'info' } };
export const Success: Story = { args: { label: 'PASSED', tone: 'success' } };
export const Danger: Story = { args: { label: 'FAILED', tone: 'danger' } };

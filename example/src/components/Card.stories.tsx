import type { Meta, StoryObj } from '@storybook/react-native';
import { Card } from './Card';

const meta = {
  title: 'Card',
  component: Card,
  args: {
    title: 'Visual regression',
    body: 'Each story is rendered on the device, captured natively, and compared with a baseline PNG.',
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextOnly: Story = {};

export const WithImage: Story = {
  args: { image: require('../assets/landscape.png') },
};

/** The spinner never stops moving, so this story is left out of visual tests. */
export const Loading: Story = {
  args: { loading: true },
  tags: ['no-vrt'],
};

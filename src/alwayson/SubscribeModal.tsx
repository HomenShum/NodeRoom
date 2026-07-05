/**
 * Always-On Rooms — subscribe modal (double opt-in email capture).
 * Ports design-reference/alwayson/ao-ops.jsx §4 left column. Opened from the
 * public room page header and the landing cards. Implemented by the room lane.
 */

export type SubscribeModalProps = {
  roomSlug: string;
  roomTitle: string;
  onClose: () => void;
};

export function SubscribeModal(_props: SubscribeModalProps): JSX.Element | null {
  return null;
}
